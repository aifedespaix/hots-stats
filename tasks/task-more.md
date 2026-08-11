Comme le build de l'executable python es très long (genre 20 min+)
on va optimiser la logique du process pour aovir le moins de modifs à faire :
l'api dis au demon ec q'uil veut,
le daemon lui envoie
si l'api se met à jour et demande plus le daemon le sait et envoie les datas en plus pour chaque game
seul une update du hero prtocole demande un rebuild
ensuite pour le demon en tant que tel, pour le dossier du jeu, par défaut il faut chercher
C:/Users/[NOM DU COMPTE]/Documents/Heroes of the Storm/Accounts/415612224/2-Hero-1-4929240/Replays/Multiplayer
en remplaçant nom du compte poar le vrai nom si tu sais comment el trouver
et deplus si le dossier existe aps tu vides le champ pour que la perosnne cehrhce tout seul
et dans le sstas en bas tu dois afficher :
nombre de parties trovuée dans le dossier
nombre de parties synchronisés avec le back comme ça on sait que ça bosse
et dis quelle partie en train de sync comme ça on voit en direct
évidemnt il doit e^tre caapble de détecter les novuelels aprtie squand elles popent
par contr ej'ai config le daemon et j'ai rien d'upload, donc si y'a erreur faut afficher et vérifei poruquoi aussi
et si possible le exe et la trayicon tu peux mettre la favicon qui est dans apps/web/public (cc'est un svg tu peux adapte rico si besoin)
le build c'est possible de juste donner le .exe sans le zip, vu que 'ya qu'un fichier.
et commetn signer pour pas avoir de soucis windows ?
autre soucis, le build a marchcé sauff que je retrouve pas le ffichier dans les realeases, est-ce que tu saurais ocmment faire ?
