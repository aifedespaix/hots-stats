"""The first-run / reconnect wizard as a self-contained Tk widget.

It owns no application state: the window hands it the shared `replays_var` /
`autostart_var` and an `OnboardingHooks` bundle, so every side effect (browser
handshake, token check, saving) stays in gui.py and this widget can be
smoke-tested headless. Worker threads never touch Tk: results come back through
`hooks.schedule` (gui.py's `_after_if_open`)."""

from __future__ import annotations

import base64
import io
import threading
import tkinter as tk
from dataclasses import dataclass
from tkinter import ttk
from typing import Callable

from PIL import Image, ImageTk

from ._icon_data import TRAY_ICON_PNG_BASE64
from .auth_flow import AuthorizationResult
from .gui_widgets import ACCENT, BG, ERROR, FIELD_BG, FIELD_BG_FOCUS, OK, PANEL, TEXT, TEXT_MUTED
from .onboarding import (
    STEP_LABELS,
    Step,
    View,
    WizardFlow,
    describe_replays_dir,
    normalize_pasted_token,
)

_FONT = "Segoe UI"
_CONNECTED_PAUSE_MS = 700
_WRAP = 440
_CONNECT_TEXT = "🌐  Se connecter via le navigateur"
_SPINNER_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
_SPINNER_MS = 120


@dataclass
class OnboardingHooks:
    authorize: Callable[[threading.Event], AuthorizationResult]
    verify_token: Callable[[str], bool]  # runs on a worker thread
    open_token_page: Callable[[], None]
    schedule: Callable[..., None]  # thread-safe "call this on the Tk thread"
    browse_dir: Callable[[], None]
    on_autostart_toggled: Callable[[], None]
    store_token: Callable[[str], None]
    finish: Callable[[], None]


class Stepper(tk.Frame):
    """① Connexion — ② Stockage — ③ C'est prêt, with done/active/todo states."""

    def __init__(self, parent: tk.Misc, labels: list[str]) -> None:
        super().__init__(parent, bg=BG)
        self._items: list[tuple[tk.Label, tk.Label]] = []
        for index, text in enumerate(labels):
            if index:
                tk.Frame(self, bg=FIELD_BG, height=2, width=28).pack(side="left", padx=8)
            dot = tk.Label(self, text=str(index + 1), width=2, font=(_FONT, 9, "bold"), bg=FIELD_BG, fg=TEXT_MUTED)
            dot.pack(side="left")
            name = tk.Label(self, text=text, bg=BG, fg=TEXT_MUTED, font=(_FONT, 10))
            name.pack(side="left", padx=(6, 0))
            self._items.append((dot, name))

    def set_active(self, index: int) -> None:
        for i, (dot, name) in enumerate(self._items):
            if i < index:
                dot.configure(text="✓", bg=OK, fg=BG)
                name.configure(fg=TEXT, font=(_FONT, 10))
            elif i == index:
                dot.configure(text=str(i + 1), bg=ACCENT, fg=BG)
                name.configure(fg=TEXT, font=(_FONT, 10, "bold"))
            else:
                dot.configure(text=str(i + 1), bg=FIELD_BG, fg=TEXT_MUTED)
                name.configure(fg=TEXT_MUTED, font=(_FONT, 10))


def _load_logo(master: tk.Misc, size: int = 72) -> ImageTk.PhotoImage:
    image = Image.open(io.BytesIO(base64.b64decode(TRAY_ICON_PNG_BASE64))).convert("RGBA")
    return ImageTk.PhotoImage(image.resize((size, size), Image.LANCZOS), master=master)


class OnboardingView(tk.Frame):
    LOADING_MS = 900

    def __init__(
        self,
        parent: tk.Misc,
        *,
        view: View,
        replays_var: tk.StringVar,
        autostart_var: tk.BooleanVar | None,
        hooks: OnboardingHooks,
        version: str,
    ) -> None:
        super().__init__(parent, bg=BG)
        self.flow = WizardFlow(view)
        self._full = view is View.WIZARD_FULL
        self._replays_var = replays_var
        self._autostart_var = autostart_var
        self._hooks = hooks
        self._alive = True
        self._jobs: list[str] = []
        self._busy = False
        self._waiting = False
        self._spin_index = 0
        self._cancel = threading.Event()
        self._paste_var = tk.StringVar(master=self)
        self._logo = _load_logo(self)
        self._continue_button: ttk.Button | None = None
        self._finish_button: ttk.Button | None = None

        header = tk.Frame(self, bg=BG)
        header.pack(pady=(8, 14))
        tk.Label(header, image=self._logo, bg=BG).pack()
        tk.Label(header, text="HotS Analytics", bg=BG, fg=TEXT, font=(_FONT, 20, "bold")).pack(pady=(6, 0))
        tk.Label(header, text=f"v{version}", bg=BG, fg=TEXT_MUTED, font=(_FONT, 9)).pack()

        self._stepper: Stepper | None = None
        if self._full:
            self._stepper = Stepper(self, [STEP_LABELS[s] for s in self.flow.steps])
            self._stepper.pack(pady=(0, 14))

        self._body = tk.Frame(self, bg=BG)
        self._body.pack(fill="both", expand=True, padx=24)
        self._trace = replays_var.trace_add("write", self._on_replays_changed)

    # -- lifecycle --------------------------------------------------------

    def start(self, animate: bool = True) -> None:
        if not animate:
            self._render(Step.CONNECT)
            return
        self._clear()
        tk.Label(self._body, text="Préparation…", bg=BG, fg=TEXT_MUTED, font=(_FONT, 10)).pack(pady=(30, 8))
        bar = ttk.Progressbar(self._body, mode="determinate", maximum=100, length=260)
        bar.pack()
        steps = 20

        def tick(i: int = 0) -> None:
            if not self._alive:
                return
            bar["value"] = i * 100 / steps
            if i >= steps:
                self._render(Step.CONNECT)
                return
            self._later(self.LOADING_MS // steps, tick, i + 1)

        tick()

    def destroy(self) -> None:
        self._alive = False
        self._cancel.set()  # releases a pending loopback wait immediately
        for job in self._jobs:
            try:
                self.after_cancel(job)
            except tk.TclError:
                pass
        self._jobs.clear()
        try:
            self._replays_var.trace_remove("write", self._trace)
        except tk.TclError:
            pass
        super().destroy()

    def _later(self, ms: int, func: Callable, *args) -> None:
        self._jobs.append(self.after(ms, func, *args))

    # -- rendering helpers ------------------------------------------------

    def _clear(self) -> None:
        for child in self._body.winfo_children():
            child.destroy()
        self._continue_button = None
        self._finish_button = None

    def _heading(self, title: str, subtitle: str) -> None:
        tk.Label(self._body, text=title, bg=BG, fg=TEXT, font=(_FONT, 15, "bold")).pack()
        tk.Label(
            self._body, text=subtitle, bg=BG, fg=TEXT_MUTED, font=(_FONT, 10), wraplength=_WRAP, justify="center"
        ).pack(pady=(4, 0))

    def _link(self, parent: tk.Misc, text: str, command: Callable[[], None]) -> tk.Label:
        label = tk.Label(parent, text=text, bg=BG, fg=ACCENT, font=(_FONT, 9, "underline"), cursor="hand2")
        label.bind("<Button-1>", lambda _e: command())
        return label

    def _set_status(self, text: str, color: str) -> None:
        self._status.configure(text=text, fg=color)

    def _nav(self, *, back: bool, next_text: str, next_cmd: Callable[[], None], enabled: bool = True) -> ttk.Button:
        bar = tk.Frame(self._body, bg=BG)
        bar.pack(side="bottom", fill="x", pady=(18, 0))
        if back:
            ttk.Button(bar, text="← Retour", style="Secondary.TButton", command=self._back).pack(side="left")
        button = ttk.Button(bar, text=next_text, style="Primary.TButton", command=next_cmd)
        button.pack(side="right")
        if not enabled:
            button.state(["disabled"])
        return button

    def _render(self, step: Step) -> None:
        if not self._alive:
            return
        self.flow.step = step
        if self._stepper is not None:
            self._stepper.set_active(self.flow.steps.index(step))
        self._clear()
        {Step.CONNECT: self._build_connect, Step.STORAGE: self._build_storage, Step.READY: self._build_ready}[step]()

    def _advance(self) -> None:
        if not self._alive:
            return
        nxt = self.flow.advance()
        if nxt is None:
            self._hooks.finish()
        else:
            self._render(nxt)

    def _back(self) -> None:
        self._render(self.flow.back())

    # -- step 1: connect --------------------------------------------------

    def _build_connect(self) -> None:
        body = self._body
        if self._full:
            self._heading("Connecte ton compte", "Autorise ce PC depuis ton navigateur. C'est rapide, et sans mot de passe à copier.")
        else:
            self._heading("Reconnexion nécessaire", "Le token de ce PC n'est plus valide. Autorise-le à nouveau depuis ton navigateur.")

        self._connect_button = ttk.Button(
            body, text=_CONNECT_TEXT, style="Primary.TButton", command=self._start_connect
        )
        self._connect_button.pack(pady=(18, 6), ipadx=18, ipady=6)
        self._cancel_link = self._link(body, "Annuler", self._cancel_connect)
        self._status = tk.Label(body, text="", bg=BG, fg=TEXT_MUTED, font=(_FONT, 9), wraplength=_WRAP, justify="center")
        self._status.pack(pady=(4, 10))

        guide = tk.Frame(body, bg=PANEL)
        guide.pack(fill="x", pady=(0, 10))
        for text in (
            "1.  Ton navigateur s'ouvre sur HotS Analytics.",
            "2.  Connecte-toi si besoin, puis clique sur « Autoriser ce PC ».",
            "3.  Reviens ici : la suite se fait toute seule.",
        ):
            tk.Label(guide, text=text, bg=PANEL, fg=TEXT, font=(_FONT, 9), anchor="w").pack(fill="x", padx=14, pady=3)

        self._manual_link = self._link(body, "Ça ne marche pas ? Récupérer le token manuellement", self._toggle_manual)
        self._manual_frame = tk.Frame(body, bg=BG)

    def _start_connect(self) -> None:
        if self._busy:
            return
        self._busy = True
        self._waiting = True
        self._cancel = threading.Event()
        cancel = self._cancel
        self._connect_button.state(["disabled"])
        self._spin_index = 0
        self._spin()
        self._cancel_link.pack(after=self._connect_button)
        self._set_status("Navigateur ouvert : termine l'autorisation, puis reviens ici.", TEXT_MUTED)

        def work() -> None:
            result = self._hooks.authorize(cancel)
            self._hooks.schedule(self._on_auth_result, result)

        threading.Thread(target=work, name="hots-wizard-auth", daemon=True).start()

    def _spin(self) -> None:
        if not (self._alive and self._waiting and self.flow.step is Step.CONNECT):
            return
        frame = _SPINNER_FRAMES[self._spin_index % len(_SPINNER_FRAMES)]
        self._spin_index += 1
        self._connect_button.configure(text=f"{frame}  Connexion…")
        self._later(_SPINNER_MS, self._spin)

    def _stop_spinner(self) -> None:
        self._waiting = False
        self._connect_button.configure(text=_CONNECT_TEXT)

    def _cancel_connect(self) -> None:
        self._cancel.set()

    def _on_auth_result(self, result: AuthorizationResult) -> None:
        if not self._alive or self.flow.step is not Step.CONNECT:
            return
        self._stop_spinner()
        self._cancel_link.pack_forget()
        if result.token:
            self._token_accepted(result.token)
            return
        self._busy = False
        self._connect_button.state(["!disabled"])
        self._set_status(f"✗ {result.error or 'Échec de la connexion.'}", ERROR)
        if not self._manual_link.winfo_ismapped():
            self._manual_link.pack(pady=(0, 6))

    def _token_accepted(self, token: str) -> None:
        # Stay busy and keep the buttons disabled until _advance: the pause must not allow a second submit.
        self._busy = True
        self._connect_button.state(["disabled"])
        validate = getattr(self, "_validate_button", None)
        if validate is not None and validate.winfo_exists():
            validate.state(["disabled"])
        self._hooks.store_token(token)
        self._set_status("✓ Connecté !", OK)
        self._later(_CONNECTED_PAUSE_MS, self._advance)

    def _toggle_manual(self) -> None:
        if self._manual_frame.winfo_ismapped():
            self._manual_frame.pack_forget()
            return
        frame = self._manual_frame
        for child in frame.winfo_children():
            child.destroy()
        tk.Label(
            frame,
            text="Ouvre la page des tokens, génère-en un (il est copié automatiquement), puis colle-le ici.",
            bg=BG, fg=TEXT_MUTED, font=(_FONT, 9), wraplength=_WRAP, justify="center",
        ).pack(pady=(4, 6))
        ttk.Button(frame, text="Ouvrir la page des tokens", style="Secondary.TButton", command=self._hooks.open_token_page).pack()
        tk.Label(
            frame,
            text="Pas encore connecté sur le site ? Connecte-toi, puis rouvre cette page depuis ici.",
            bg=BG, fg=TEXT_MUTED, font=(_FONT, 8), wraplength=_WRAP, justify="center",
        ).pack(pady=(4, 8))
        wrapper = tk.Frame(frame, bg=FIELD_BG, highlightthickness=1, highlightbackground=FIELD_BG)
        wrapper.pack(fill="x")
        entry = tk.Entry(
            wrapper, textvariable=self._paste_var, bg=FIELD_BG, fg=TEXT, insertbackground=TEXT,
            relief="flat", font=(_FONT, 10),
        )
        entry.pack(fill="x", padx=10, pady=8)
        entry.bind("<FocusIn>", lambda _e: wrapper.configure(bg=FIELD_BG_FOCUS, highlightbackground=ACCENT))
        entry.bind("<FocusOut>", lambda _e: wrapper.configure(bg=FIELD_BG, highlightbackground=FIELD_BG))
        self._validate_button = ttk.Button(frame, text="Valider", style="Primary.TButton", command=self._validate_manual)
        self._validate_button.pack(pady=(8, 0))
        frame.pack(fill="x", pady=(4, 0))
        entry.focus_set()

    def _validate_manual(self) -> None:
        if self._busy:
            return
        token = normalize_pasted_token(self._paste_var.get())
        if token is None:
            self._set_status("✗ Ce n'est pas un token valide : il commence par « hots_pat_ » et ne contient pas d'espace.", ERROR)
            return
        self._busy = True
        self._validate_button.state(["disabled"])
        self._set_status("Vérification du token…", TEXT_MUTED)

        def work() -> None:
            ok = self._hooks.verify_token(token)
            self._hooks.schedule(self._on_manual_result, token, ok)

        threading.Thread(target=work, name="hots-wizard-verify", daemon=True).start()

    def _on_manual_result(self, token: str, ok: bool) -> None:
        if not self._alive or self.flow.step is not Step.CONNECT:
            return
        if ok:
            self._token_accepted(token)
        else:
            self._busy = False
            self._validate_button.state(["!disabled"])
            self._set_status("✗ Le serveur a refusé ce token. Génère-en un nouveau sur la page des tokens.", ERROR)

    # -- step 2: storage --------------------------------------------------

    def _build_storage(self) -> None:
        body = self._body
        self._heading("Où sont tes replays ?", "On les détecte automatiquement. Change le dossier seulement si besoin.")
        self._continue_button = self._nav(back=True, next_text="Continuer →", next_cmd=self._advance, enabled=False)

        row = tk.Frame(body, bg=BG)
        row.pack(fill="x", pady=(16, 0))
        wrapper = tk.Frame(row, bg=FIELD_BG, highlightthickness=1, highlightbackground=FIELD_BG)
        wrapper.pack(side="left", fill="x", expand=True)
        tk.Entry(
            wrapper, textvariable=self._replays_var, bg=FIELD_BG, fg=TEXT, insertbackground=TEXT,
            relief="flat", font=(_FONT, 10),
        ).pack(fill="x", padx=10, pady=8)
        ttk.Button(row, text="Parcourir…", style="Secondary.TButton", command=self._hooks.browse_dir).pack(side="left", padx=(8, 0))

        self._dir_status = tk.Label(body, text="", bg=BG, fg=TEXT_MUTED, font=(_FONT, 9), anchor="w")
        self._dir_status.pack(fill="x", pady=(6, 0))
        self._dir_summary = tk.Label(body, text="", bg=BG, fg=TEXT_MUTED, font=(_FONT, 9), anchor="w", justify="left", wraplength=_WRAP)
        self._dir_summary.pack(fill="x", pady=(2, 0))

        if self._autostart_var is not None:
            tk.Checkbutton(
                body, text="Lancer HotS Analytics au démarrage de Windows (en arrière-plan)",
                variable=self._autostart_var, command=self._on_autostart,
                bg=BG, fg=TEXT, selectcolor=FIELD_BG, activebackground=BG, activeforeground=TEXT,
                highlightthickness=0, borderwidth=0, font=(_FONT, 9), anchor="w",
            ).pack(fill="x", pady=(16, 0))
        self._refresh_dir()

    def _on_autostart(self) -> None:
        self._hooks.on_autostart_toggled()

    def _on_replays_changed(self, *_args) -> None:
        if self._alive and self.flow.step is Step.STORAGE and self._continue_button is not None:
            self._refresh_dir()

    def _refresh_dir(self) -> None:
        check = describe_replays_dir(self._replays_var.get())
        self._dir_status.configure(text=check.status, fg=OK if check.ok else ERROR)
        self._dir_summary.configure(text=check.summary)
        if self._continue_button is not None:
            self._continue_button.state(["!disabled"] if check.ok else ["disabled"])

    # -- step 3: ready ----------------------------------------------------

    def _build_ready(self) -> None:
        body = self._body
        self._heading("Tout est prêt !", "HotS Analytics va synchroniser tes parties en arrière-plan.")
        self._finish_button = self._nav(back=True, next_text="Accéder à l'app →", next_cmd=self._hooks.finish)

        recap = tk.Frame(body, bg=PANEL)
        recap.pack(fill="x", pady=(16, 0))
        lines = [
            "✓  Compte connecté",
            f"✓  Dossier surveillé : {self._replays_var.get().strip()}",
        ]
        if self._autostart_var is not None:
            lines.append("✓  Lancement avec Windows : " + ("activé" if self._autostart_var.get() else "désactivé"))
        for text in lines:
            tk.Label(
                recap, text=text, bg=PANEL, fg=TEXT, font=(_FONT, 9), anchor="w", justify="left", wraplength=_WRAP,
            ).pack(fill="x", padx=14, pady=4)
