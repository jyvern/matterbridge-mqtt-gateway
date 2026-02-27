# Guide de déploiement — matterbridge-mqtt

## Vue d'ensemble

Ce guide couvre l'installation du plugin `matterbridge-mqtt` dans une instance Matterbridge tournant sous Docker.
Il documente l'ensemble des opérations réalisées lors du développement et de la mise au point du plugin.

---

## Prérequis

- Docker et Docker Compose installés sur l'hôte
- Instance Matterbridge v3.x déjà fonctionnelle en container
- Accès SSH ou terminal à l'hôte Docker
- Un broker MQTT accessible depuis le container (ex: `mqtt://192.168.35.55:1883`)
- Node.js ≥ 20 sur l'hôte (pour compiler le plugin si nécessaire)

---

## Structure du plugin

```
matterbridge-mqtt/
├── src/
│   ├── index.ts           ← point d'entrée
│   ├── platform.ts        ← logique principale (DynamicPlatform)
│   └── ambient.d.ts       ← déclarations de types
├── dist/                  ← code compilé (généré par tsc)
├── package.json
├── tsconfig.json
└── matterbridge-mqtt.schema.json   ← schéma de config (interface UI)
```

---

## Étape 1 — Compiler le plugin

Sur ta machine de développement (ou directement sur l'hôte si Node.js est présent) :

```bash
cd matterbridge-mqtt/
npm install
npm run build
```

Vérifier que le dossier `dist/` est bien généré avec `platform.js`, `index.js` et leurs fichiers `.d.ts`.

---

## Étape 2 — Identifier le volume Matterbridge dans Docker

Le plugin doit être installé dans le volume partagé par le container Matterbridge.
Trouver le chemin du volume :

```bash
docker inspect <nom_du_container_matterbridge> | grep -A5 "Mounts"
```

Le volume contient généralement un dossier `node_modules/` et un fichier de config.
Exemple typique :

```
/opt/matterbridge/          ← volume monté
├── node_modules/
├── matterbridge-mqtt.config.json
└── ...
```

---

## Étape 3 — Installer le plugin *(deux méthodes)*

### ✅ Méthode A — Via package `.tgz` (recommandée)

C'est la méthode la plus propre : npm gère automatiquement la structure des dossiers,
les dépendances du plugin, et l'intégrité du package.

**Sur la machine de développement, générer le package :**

```bash
cd matterbridge-mqtt/
npm pack
# → génère : matterbridge-mqtt-1.0.0.tgz
```

> `npm pack` inclut automatiquement `dist/`, `src/`, `package.json` et `matterbridge-mqtt.schema.json`
> car le `package.json` ne définit pas de champ `files` restrictif.

**Copier le `.tgz` sur l'hôte Docker puis l'installer :**

```bash
# Copier le tgz dans le volume
scp matterbridge-mqtt-1.0.0.tgz user@hote:/opt/matterbridge/

# Installer depuis le container
docker exec -it <nom_container> npm install /opt/matterbridge/matterbridge-mqtt-1.0.0.tgz
```

npm installe le plugin dans `node_modules/matterbridge-mqtt/` et résout automatiquement
la dépendance `mqtt`. Passer directement à l'**Étape 4**.

---

### Méthode B — Copie manuelle du dossier

À utiliser si l'accès à npm depuis le container est impossible.

```bash
# Copier le dossier entier du plugin dans node_modules du volume
cp -r matterbridge-mqtt/ /opt/matterbridge/node_modules/matterbridge-mqtt/
```

> **Important :** Le dossier `dist/` compilé doit être présent.
> Ne pas oublier `matterbridge-mqtt.schema.json` à la racine du plugin.

Vérifier la structure finale :

```
/opt/matterbridge/node_modules/matterbridge-mqtt/
├── dist/
│   ├── index.js
│   ├── index.d.ts
│   ├── platform.js
│   └── platform.d.ts
├── node_modules/          ← dépendances du plugin (mqtt, etc.)
├── package.json
├── matterbridge-mqtt.schema.json
└── src/
```

**Installer ensuite les dépendances manuellement :**

```bash
cd /opt/matterbridge/node_modules/matterbridge-mqtt/
npm install --omit=dev
```

Ou via `docker exec` si Node.js n'est pas disponible directement sur l'hôte :

```bash
docker exec -it <nom_container> sh -c "cd /root/Matterbridge/node_modules/matterbridge-mqtt && npm install --omit=dev"
```

---

## Étape 4 — Déployer le fichier de configuration

Le fichier de config du plugin doit être placé dans le répertoire de données de Matterbridge
(généralement à la racine du volume, pas dans `node_modules/`).

**Fichier : `matterbridge-mqtt.config.json`**

```json
{
  "name": "matterbridge-mqtt",
  "type": "DynamicPlatform",
  "broker": "mqtt://192.168.35.55:1883",
  "username": "",
  "password": "",
  "version": "1.0.0",
  "debug": false,
  "unregisterOnShutdown": false,
  "devices": [
    {
      "id": "lampe_salon",
      "name": "Lampe Salon",
      "type": "light",
      "stateTopic": "mattermqtt/lampe_salon/state",
      "commandTopic": "mattermqtt/lampe_salon/set",
      "payloadOn": "ON",
      "payloadOff": "OFF"
    },
    {
      "id": "prise_bureau",
      "name": "Prise Bureau",
      "type": "outlet",
      "stateTopic": "mattermqtt/prise_bureau/state",
      "commandTopic": "mattermqtt/prise_bureau/set"
    },
    {
      "id": "temp_chambre",
      "name": "Température Chambre",
      "type": "temperature",
      "stateTopic": "mattermqtt/capteur_chambre/state"
    }
  ]
}
```

> ⚠️ **Point critique résolu :** Le champ s'appelle `"broker"` (URL complète), pas `"host"` + `"port"` séparément.

Copier ce fichier dans le volume :

```bash
cp matterbridge-mqtt.config.json /opt/matterbridge/
```

---

## Étape 5 — Enregistrer le plugin dans Matterbridge

Matterbridge doit connaître le plugin. L'enregistrement se fait via la commande CLI
ou directement depuis l'interface web de Matterbridge.

**Via CLI dans le container :**

```bash
docker exec -it <nom_container> matterbridge -add matterbridge-mqtt
```

**Via l'interface web :**
Aller dans `Plugins` → `Add plugin` → saisir `matterbridge-mqtt`.

---

## Étape 6 — Corriger le schéma JSON (point critique)

Le fichier `matterbridge-mqtt.schema.json` **doit** décrire précisément les propriétés
des devices pour que l'interface web les affiche et permette leur édition.

La version corrigée du schéma est celle livrée dans ce déploiement.
Elle définit pour chaque device : `id`, `name`, `type` (enum), `stateTopic`,
`commandTopic`, `payloadOn`, `payloadOff`.

Sans ce schéma correct, les devices apparaissent dans le fichier JSON
mais **ne s'affichent pas dans l'interface** et ne peuvent pas être édités.

Vérifier que le fichier déployé dans `node_modules/matterbridge-mqtt/`
est bien la version corrigée (taille ≈ 1,8 Ko).

---

## Étape 7 — Redémarrer Matterbridge

```bash
docker restart <nom_du_container_matterbridge>
```

Vérifier les logs au démarrage :

```bash
docker logs -f <nom_du_container_matterbridge>
```

Les lignes attendues ressemblent à :

```
[MqttPlatform] Connecting to broker mqtt://192.168.35.55:1883
[MqttPlatform] MQTT connected
[MqttPlatform] Registering device: Lampe Salon (light)
[MqttPlatform] Registering device: Prise Bureau (outlet)
[MqttPlatform] Registering device: Température Chambre (temperature)
```

---

## Récapitulatif des corrections apportées

| Problème | Symptôme | Correction |
|---|---|---|
| `schema.json` incomplet | Devices non visibles/éditables dans l'UI | Ajout de la définition complète des propriétés dans `items` |
| Champ config `host`/`port` | Connexion MQTT impossible | Remplacement par `"broker": "mqtt://IP:PORT"` |

---

## Mises à jour futures du plugin

### Via `.tgz` (recommandé)

```bash
# 1. Modifier src/platform.ts
# 2. Incrémenter la version dans package.json (ex: 1.0.0 → 1.1.0)
# 3. Recompiler et générer le nouveau package
npm run build && npm pack

# 4. Copier et réinstaller
scp matterbridge-mqtt-1.1.0.tgz user@hote:/opt/matterbridge/
docker exec -it <nom_container> npm install /opt/matterbridge/matterbridge-mqtt-1.1.0.tgz

# 5. Redémarrer
docker restart <nom_container>
```

### Via copie manuelle

```bash
# 1. Modifier src/platform.ts
# 2. Recompiler
npm run build

# 3. Copier le dossier dist/ mis à jour
cp -r dist/ /opt/matterbridge/node_modules/matterbridge-mqtt/dist/

# 4. Si le schema.json a changé, le copier aussi
cp matterbridge-mqtt.schema.json /opt/matterbridge/node_modules/matterbridge-mqtt/

# 5. Redémarrer
docker restart <nom_container>
```

---

## Résolution de problèmes

**Les devices n'apparaissent pas dans l'interface**
→ Vérifier que `matterbridge-mqtt.schema.json` est la version corrigée avec les propriétés détaillées.

**Erreur de connexion MQTT**
→ Vérifier que `"broker"` est bien une URL complète : `mqtt://IP:port`.
→ Tester la connectivité depuis le container : `docker exec -it <container> ping 192.168.35.55`

**Plugin non chargé au démarrage**
→ Vérifier que `dist/index.js` existe et que `package.json` pointe bien vers `"main": "dist/index.js"`.
→ Vérifier que la dépendance `mqtt` est installée dans `node_modules/matterbridge-mqtt/node_modules/`.

**Devices enregistrés mais pas de mise à jour d'état**
→ Vérifier les `stateTopic` dans la config et tester avec un client MQTT (ex: MQTT Explorer).
