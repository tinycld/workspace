---
title: Light and dark themes
summary: Changing the appearance of the app
tags: [theme, appearance, "dark mode"]
order: 30
---

## Light and dark mode

The app supports a light theme, a dark theme, and a "follow system" option that tracks your OS appearance preference.

## Changing the theme

Open **Settings → Appearance** to choose between Light, Dark, or System.

Your preference is stored per-user and follows you across devices when you sign in.

## How theming works under the hood

Colors are defined as semantic tokens — `foreground`, `background`, `muted`, `accent`, `danger`, and so on. Each token has a light value and a dark value defined in `global.css`. Components reference tokens (`text-foreground`, `bg-background`) rather than raw hex values, so flipping themes is instant.

Custom packages can extend the token set; they're picked up automatically wherever className-based styling is used.
