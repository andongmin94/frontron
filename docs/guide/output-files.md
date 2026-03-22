# Understand the Output Files

After a build, the next step is to understand which folder is responsible for what.

Even if there are many files, the structure is easier to read when you group it by role.

## 1. `dist/`

This is the built renderer output.

You can think of it as the production-ready result of the web frontend.

## 2. `.frontron/`

This is the staging area that Frontron manages.

It includes things such as:

- generated bridge types
- staged runtime files
- staged build app files
- runtime manifests

If you are checking whether the framework prepared the desktop layer correctly, this is the first folder to inspect.

## 3. `output/`

This is where the packaged desktop app is written.

On Windows, you will usually see things such as:

- `win-unpacked/`
- an installer `.exe`

This is the most direct proof that the project was packaged into a desktop app.

## 4. Why file names can differ

File names can change based on:

- the app name
- the app version
- the target platform

So it is better to focus on file role and file extension first, not on an exact file name.

## 5. The simplest success checklist

At the beginning, these questions are enough:

- Was `dist/` created?
- Was `.frontron/` created?
- Was `output/` created?
- Does `output/` contain `win-unpacked/` or an installer file?

If those checks pass, the build flow is usually healthy.
