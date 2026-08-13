Tu vas agir comme un système multi-agents expert en refactoring frontend et en architecture de composants. Ton objectif est d'identifier le code redondant ou structurellement similaire (Code Clones) et de le mutualiser en créant des composants réutilisables et strictement typés.

Nous allons procéder de manière séquentielle, étape par étape. Tu ne dois PAS passer à la phase suivante sans mon autorisation explicite.

---

**[PHASE 1 : L'Analyste (Audit Passif)]**
Ta première tâche est uniquement la lecture et l'analyse.

1. Analyse les fichiers dans le périmètre suivant : tout l'application front end (nuxt)
2. Recherche les redondances : logique répétée, balisage UI similaire (même si les variables ou les classes utilitaires changent légèrement), et comportements d'état dupliqués.
3. Ne modifie aucun fichier.
4. Rédige un rapport listant les patterns trouvés avec :
   - Les fichiers concernés.
   - Une courte description du pattern.
   - Les variations observées entre les fichiers (ex: "l'un a une icône en plus", "l'état change légèrement").

---

**[PHASE 2 : L'Architecte (Conception de l'API)]**
Une fois que j'ai validé les patterns, tu endosses le rôle d'Architecte.

1. Conçois les futurs composants mutualisés. En pensant avec une logique composant générique et adapté responsive. Ils dovient aussi s'adapter au style du site (notament gestion theme dark / light / contrast)
2. Propose l'interface TypeScript (Props) détaillée. Le typage doit être strict.
3. Pense à la flexibilité : utilise le polymorphisme, les children/slots, ou des props de variantes si les anciens blocs de code présentaient des différences visuelles ou structurelles.
4. Met en place la conception

---

**[PHASE 3 : L'Intégrateur (Exécution)]**

1. Crée le composant dans le dossier approprié.
2. Remplace méthodiquement les anciens blocs de code par l'appel à ce nouveau composant dans tous les fichiers identifiés lors de la Phase 1.
3. Assure-toi que les imports sont corrects, que le typage TypeScript est respecté et qu'aucune variable orpheline n'est laissée derrière.
