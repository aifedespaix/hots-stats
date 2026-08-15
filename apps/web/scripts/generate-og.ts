import { Resvg } from "@resvg/resvg-js";
import fs from "fs/promises";
import path from "path";
import satori from "satori";

// Liste de tes pages avec leurs titres en français correspondants
const routesMap: Record<string, string> = {
  "index.vue": "Accueil",
  "login.vue": "Connexion",
  "heroes/index.vue": "Liste des Héros",
  "heroes/[slug].vue": "Détails du Héros",
  "analysis/index.vue": "Diagnostic",
  "matches/index.vue": "Historique des Matchs",
  "matches/[id].vue": "Détails du Match",
  "players/index.vue": "Classement des Joueurs",
  "players/[battletag].vue": "Profil Joueur",
  "settings/index.vue": "Paramètres du compte",
  "upload.vue": "Upload & Synchronisation",
  "u/[handle].vue": "Profil Utilisateur"
};

async function generateOgImages() {
  const cwd = process.cwd();
  const publicDir = path.join(cwd, "public");
  const ogDir = path.join(publicDir, "og");

  // Création du dossier public/og s'il n'existe pas
  await fs.mkdir(ogDir, { recursive: true });

  // Lecture du logo SVG depuis public/favicon.svg
  const logoPath = path.join(publicDir, "favicon.svg");
  const logoSvg = await fs.readFile(logoPath, "utf-8");
  const logoBase64 = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;

  // Chargement d'une police TrueType (.ttf) locale ou distante stable
  // Assure-toi d'avoir un fichier "font.ttf" dans public/fonts/ ou ajuste le chemin
  const fontPath = path.join(publicDir, "fonts/Bw Modelica/otf", "BwModelica-Bold.otf");
  
  let fontBuffer: ArrayBuffer;
  try {
    console.log("Lecture de la police locale (public/fonts/font.ttf)...");
    const localFont = await fs.readFile(fontPath);
    fontBuffer = localFont.buffer.slice(localFont.byteOffset, localFont.byteOffset + localFont.byteLength);
  } catch (e) {
    console.log("Police locale introuvable, téléchargement d'une police de secours standard...");
    fontBuffer = await fetch(
      "https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-bold-webfont.ttf"
    ).then((res) => res.arrayBuffer());
  }

  for (const [route, title] of Object.entries(routesMap)) {
    console.log(`Génération de l'image pour : ${route} -> "${title}"`);

    // Structure AST pour Satori (100% robuste, sans parseur HTML externe)
    const markup = {
      type: "div",
      props: {
        style: {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          width: "100%",
          backgroundColor: "#0f172a",
          fontFamily: "CustomFont",
        },
        children: [
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                backgroundImage: "linear-gradient(to bottom, #1e293b, #080c16)",
                width: "100%",
                height: "100%",
              },
              children: [
                {
                  type: "img",
                  props: {
                    src: logoBase64,
                    width: 240,
                    height: 240,
                    style: {
                      marginBottom: 40,
                    },
                  },
                },
                {
                  type: "h1",
                  props: {
                    style: {
                      color: "white",
                      fontSize: 64,
                      fontWeight: "bold",
                      textAlign: "center",
                      margin: 0,
                      padding: "0 40px",
                      textTransform: "uppercase",
                      letterSpacing: 2,
                    },
                    children: title,
                  },
                },
              ],
            },
          },
        ],
      },
    };

    // Génération du SVG via Satori
    const svg = await satori(markup as any, {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "CustomFont",
          data: fontBuffer,
          weight: 700,
          style: "normal",
        },
      ],
    });

    // Conversion du SVG en PNG via @resvg/resvg-js
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: 1200 },
    });
    
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    // Nettoyage du nom de fichier pour correspondre aux routes (ex: heroes-[slug].png)
    const safeFilename = route.replace(/\//g, "-").replace(".vue", "") + ".png";
    await fs.writeFile(path.join(ogDir, safeFilename), pngBuffer);
  }

  console.log("✅ Toutes les images OG ont été générées avec succès dans public/og/ !");
}

generateOgImages().catch(console.error);