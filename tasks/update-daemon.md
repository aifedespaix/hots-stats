Agis comme un développeur Python expert. J'ai un "daemon" qui tourne en boucle infinie pour synchroniser des parties de jeu vidéo. Je veux le structurer pour qu'il ait une interface de configuration et se place dans la zone de notification Windows (traybar).

Voici les spécifications techniques :

Configuration initiale : Au lancement, le script vérifie si le fichier %APPDATA%\hots-analytics\config.json existe. Si ce n'est pas le cas, il ouvre une petite fenêtre (avec tkinter ou customtkinter) pour demander 3 champs : API Key, API Base URL, et Replay Directory. Ces données doivent être sauvegardées dans le JSON.
Le api base par défaut : api-hots-stats.aifedespaix.com (montr eel champ en vert si ping ok)
Le dossier des repaly : C:\Users\clape\Documents\Heroes of the Storm\Accounts\415612224\2-Hero-1-4929240\Replays\Multiplayer
adapter avec le nom de l'user si possible, et test si exist ee tmet en vert si ok sinon effface et demande remplir
l'access tyoken, donne un lien qui envoie vers la page du front pour récupérer /gen la token

Traybar : Une fois la configuration validée (ou si le JSON existait déjà), l'application crée une icône dans la barre des tâches en utilisant pystray. Le menu doit permettre de réouvrir les paramètres ou de quitter.

Gestion des Threads : Le daemon de synchronisation doit se lancer dans un thread séparé en arrière-plan pour ne pas bloquer l'interface graphique principale.

Interface et Statistiques : Lorsque l'on réouvre la fenêtre depuis la traybar, les champs de configuration doivent être pré-remplis. La fenêtre doit également afficher deux statistiques : la version du logiciel et le nombre de "games" enregistrées.

Rédige l'architecture du code complet, de manière propre et commentée, en t'assurant que la fermeture depuis la traybar arrête proprement le thread du daemon.

Faut une interface simple et agréable à regarder
et si faut update le github worflow tu peux le faire
le github plante au build voici ce que son ia me dis :

I'll retrieve the job logs to identify the failure and provide a solution.

Job 93847401991 in aifedespaix/hots-stats
Now let me get the workflow file and the main.py to understand the context better:

Using results of get file and 1 other tool call
Problem
The build is failing with an ImportError: attempted relative import with no known parent package when Nuitka tries to compile src/main.py into a standalone executable.

The issue occurs because Nuitka is compiling src/main.py directly, but the file uses relative imports (lines 15-18):

Python
from . import api_client
from . import parser as replay_parser
from .config import ConfigError, load_config
from .watcher import watch_replays
When Nuitka compiles a script directly with --onefile, it doesn't treat the file as part of a package, so the relative imports fail.

Solution
Change the Nuitka build command to target the package's **main**.py entry point instead of main.py directly. First, create a daemon-python/src/**main**.py file that serves as the package entry point:

File: daemon-python/src/**main**.py

Python
"""Entry point when the src package is executed as a module."""
from .main import main
import sys

if **name** == "**main**":
sys.exit(main())
Then update the workflow to compile the package instead of the script:

File: .github/workflows/build-daemon.yml (line 72)

Change:

bash
python -m nuitka
...
src/main.py
To:

bash
python -m nuitka
...
--module src
Or alternatively, run it as a module:

bash
python -m nuitka
...
-m src
This tells Nuitka to compile src as a proper Python package, preserving the package context needed for relative imports to work.

vérifie si c'est intelligent et corrige si tu veux
(voici l'erreur :
Run ./dist/hots-analytics-daemon-v0.0.0-dev.9d69a76.exe --help
./dist/hots-analytics-daemon-v0.0.0-dev.9d69a76.exe --help
shell: C:\Program Files\Git\bin\bash.EXE --noprofile --norc -e -o pipefail {0}
env:
PYTHON_VERSION: 3.11
pythonLocation: C:\hostedtoolcache\windows\Python\3.11.9\x64
PKG_CONFIG_PATH: C:\hostedtoolcache\windows\Python\3.11.9\x64/lib/pkgconfig
Python_ROOT_DIR: C:\hostedtoolcache\windows\Python\3.11.9\x64
Python2_ROOT_DIR: C:\hostedtoolcache\windows\Python\3.11.9\x64
Python3_ROOT_DIR: C:\hostedtoolcache\windows\Python\3.11.9\x64
Traceback (most recent call last):
File "C:\Users\RUNNER~1\AppData\Local\Temp\onefile_5504_194344_neY5vXnzuKs\main.py", line 15, in <module>
ImportError: attempted relative import with no known parent package
Error: Process completed with exit code 1.)
)
