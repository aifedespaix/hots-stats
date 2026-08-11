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
