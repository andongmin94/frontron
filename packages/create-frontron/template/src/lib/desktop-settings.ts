import { useEffect, useState } from "react"

export type CloseButtonBehavior = "hide" | "quit"

const closeButtonBehaviorStorageKey = "desktop-template.close-button-behavior"
const closeButtonBehaviorChangedEvent =
  "desktop-template:close-button-behavior-changed"

function isCloseButtonBehavior(value: unknown): value is CloseButtonBehavior {
  return value === "hide" || value === "quit"
}

export function getCloseButtonBehavior(): CloseButtonBehavior {
  if (typeof window === "undefined") {
    return "hide"
  }

  const storedValue = window.localStorage.getItem(closeButtonBehaviorStorageKey)
  return isCloseButtonBehavior(storedValue) ? storedValue : "hide"
}

export function setCloseButtonBehavior(value: CloseButtonBehavior) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(closeButtonBehaviorStorageKey, value)
  window.dispatchEvent(new Event(closeButtonBehaviorChangedEvent))
}

export function useCloseButtonBehavior() {
  const [closeButtonBehavior, setCloseButtonBehaviorState] =
    useState<CloseButtonBehavior>("hide")

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const syncCloseButtonBehavior = () => {
      setCloseButtonBehaviorState(getCloseButtonBehavior())
    }

    syncCloseButtonBehavior()

    window.addEventListener("storage", syncCloseButtonBehavior)
    window.addEventListener(
      closeButtonBehaviorChangedEvent,
      syncCloseButtonBehavior
    )

    return () => {
      window.removeEventListener("storage", syncCloseButtonBehavior)
      window.removeEventListener(
        closeButtonBehaviorChangedEvent,
        syncCloseButtonBehavior
      )
    }
  }, [])

  const updateCloseButtonBehavior = (value: CloseButtonBehavior) => {
    setCloseButtonBehavior(value)
    setCloseButtonBehaviorState(value)
  }

  return [closeButtonBehavior, updateCloseButtonBehavior] as const
}
