# Change App Name and Icon

The best first customization is something you can see right away.

This page explains how to change the icon and the app name, and where those values live in the framework-first structure.

## 1. Change the icon

The default icon file is:

```text
public/
  icon.ico
```

The icon is wired through `frontron/config.ts`:

```ts
app: {
  icon: './public/icon.ico',
}
```

If `app.icon` is omitted, Frontron falls back to its default icon.

If you replace that file with your own icon, the packaged app will use it on the next build.

## 2. Change the app name and app ID

The main app metadata lives in `frontron/config.ts`.

The first two values most people change are:

- `app.name`
- `app.id`

You can think of them like this:

- `app.name`: the product name shown in packaging and app metadata
- `app.id`: the application identifier used by the desktop app

## 3. Change visible UI text

If you want to change text that is shown directly in the starter UI, check:

- `src/components/TitleBar.tsx`
- `src/App.tsx`

The window definition itself lives in `frontron/windows/index.ts`.

## 4. Good first change order

1. Replace `public/icon.ico`
2. Update `app.name` in `frontron/config.ts`
3. Update `app.id` in `frontron/config.ts`
4. Change visible UI text in `src/components/TitleBar.tsx`

This order keeps the first customization simple and visible.

## 5. What changes after that?

- In development, visible UI text changes show up right away
- After a build, the icon and packaged app metadata change in `output/`

::: tip
Do not try to rebrand everything at once. Start with the icon and visible app name first.
:::
