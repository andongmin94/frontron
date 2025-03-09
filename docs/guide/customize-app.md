# Change App Name and Icon

The best first customization is something you can see right away.

This page explains how to change the icon and the app name, and where those values live in the current starter-driven structure.

## 1. Change the icon

The default icon file is:

```text
public/
  icon.ico
```

The icon is wired through the root `frontron.config.ts`:

```ts
app: {
  icon: './public/icon.ico',
}
```

If `app.icon` is omitted, Frontron falls back to its default icon.

## 2. Change the app name and app ID

The main app metadata lives in the root `frontron.config.ts`.

The first two values most people change are:

- `app.name`
- `app.id`

## 3. Change visible UI text

If you want to change text shown directly in the starter UI, check:

- `src/components/TitleBar.tsx`
- `src/App.tsx`

The window definition itself lives in `frontron/windows/index.ts`.

## 4. Good first change order

1. Replace `public/icon.ico`
2. Update `app.name` in the root `frontron.config.ts`
3. Update `app.id` in the root `frontron.config.ts`
4. Change visible UI text in `src/components/TitleBar.tsx`
