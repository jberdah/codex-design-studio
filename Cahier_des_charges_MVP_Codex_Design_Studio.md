# Cahier des charges MVP Codex Design Studio

## Pitch
Créez votre identité visuelle une seule fois, déclinez-la partout.

## Objectif
Prouver en 3 jours qu'un Design System unique permet de générer une landing page, un mini deck PowerPoint et de modifier visuellement le résultat via Codex.

## Fonctionnalités MVP
- Création de projet
- Brand Studio (logo, couleurs, typographies)
- Design System (tokens JSON)
- Canvas web avec preview
- Chat contextuel
- Génération landing page
- Génération de 3 slides PowerPoint
- Exports HTML/PPTX
- Validation graphique simple

## Architecture
- Frontend : Next.js + React + Tailwind
- Backend : FastAPI
- LLM : Codex App Server
- Base : SQLite
- Exports : HTML, JSON, PPTX

## Planning
- Jour 1 : projet, brand, tokens, connexion Codex
- Jour 2 : génération web, canvas, chat
- Jour 3 : PowerPoint, export, démo

## Vision post-MVP
Extension aux documents, assets et Design System complet.
