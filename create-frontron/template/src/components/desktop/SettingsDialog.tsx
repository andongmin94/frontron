import type { ReactNode } from "react"
import { useState } from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import {
  Monitor,
  Moon,
  Settings2,
  Sun,
  XIcon,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { type Theme, useTheme } from "@/components/theme-provider"
import {
  Dialog,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  type CloseButtonBehavior,
  useCloseButtonBehavior,
} from "@/lib/desktop-settings"
import { cn } from "@/lib/utils"

const TITLE_BAR_HEIGHT = 40

const closeButtonOptions: Array<{
  value: CloseButtonBehavior
  label: string
}> = [
  {
    value: "hide",
    label: "System tray",
  },
  {
    value: "quit",
    label: "Quit",
  },
]

const themeOptions: Array<{
  value: Theme
  label: string
  icon: LucideIcon
}> = [
  {
    value: "system",
    label: "System",
    icon: Monitor,
  },
  {
    value: "light",
    label: "Light",
    icon: Sun,
  },
  {
    value: "dark",
    label: "Dark",
    icon: Moon,
  },
]

type SettingsSectionProps = {
  title: string
  children: ReactNode
}

function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <section className="grid gap-3 rounded-2xl border border-border/80 bg-muted/20 p-4">
      <div className="text-[0.68rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
        {title}
      </div>
      {children}
    </section>
  )
}

type SettingsRowProps = {
  label: string
  children: ReactNode
}

function SettingsRow({ label, children }: SettingsRowProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/75 bg-background/80 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm font-medium text-foreground">{label}</div>
      {children}
    </div>
  )
}

type SettingsChoiceButtonProps = {
  active: boolean
  children: ReactNode
  onClick: () => void
}

function SettingsChoiceButton({
  active,
  children,
  onClick,
}: SettingsChoiceButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "min-w-[108px] cursor-pointer rounded-lg px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-background hover:text-foreground"
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

type ThemeIconButtonProps = {
  active: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}

function ThemeIconButton({
  active,
  icon: Icon,
  label,
  onClick,
}: ThemeIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "flex size-9 cursor-pointer items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        active
          ? "bg-foreground text-background shadow-sm"
          : "text-muted-foreground hover:bg-background hover:text-foreground"
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon className="size-[16px]" />
    </button>
  )
}

type SettingsDialogContentProps = {
  children: ReactNode
}

function SettingsDialogContent({ children }: SettingsDialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay className="top-10 bg-black/18 supports-backdrop-filter:backdrop-blur-[2px]" />
      <div
        className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center p-5"
        style={{ top: TITLE_BAR_HEIGHT }}
      >
        <DialogPrimitive.Popup
          data-slot="desktop-settings-dialog-content"
          className="relative grid w-full max-w-[28rem] gap-0 overflow-hidden rounded-[20px] border border-border/80 bg-background/95 shadow-[0_24px_70px_-34px_rgba(15,23,42,0.42)] ring-1 ring-black/5 duration-100 outline-none data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 supports-backdrop-filter:backdrop-blur-md dark:ring-white/10"
        >
          {children}
          <DialogPrimitive.Close
            data-slot="desktop-settings-dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-4 right-4 cursor-pointer rounded-full text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-white/10"
                size="icon-sm"
              />
            }
          >
            <XIcon className="size-4" />
            <span className="sr-only">Close settings</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Popup>
      </div>
    </DialogPortal>
  )
}

export default function DesktopSettingsDialog() {
  const [open, setOpen] = useState(false)
  const [closeButtonBehavior, setCloseButtonBehavior] = useCloseButtonBehavior()
  const { theme, setTheme } = useTheme()

  return (
    <>
      <button
        type="button"
        aria-label="Open desktop settings"
        className="fixed bottom-5 left-5 z-40 flex size-11 cursor-pointer items-center justify-center rounded-xl border border-border/80 bg-background/92 text-muted-foreground shadow-[0_16px_36px_-28px_rgba(15,23,42,0.45)] backdrop-blur-sm transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onClick={() => setOpen(true)}
      >
        <Settings2 className="size-[18px]" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <SettingsDialogContent>
          <DialogHeader className="border-b border-border/70 px-6 py-5">
            <DialogTitle className="text-[1.05rem] font-semibold tracking-tight">
              Settings
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 px-6 py-5">
            <SettingsSection title="Appearance">
              <SettingsRow label="Theme">
                <div className="inline-flex w-fit flex-wrap items-center gap-1 rounded-xl border border-border/80 bg-muted/35 p-1">
                  {themeOptions.map((option) => (
                    <ThemeIconButton
                      key={option.value}
                      active={theme === option.value}
                      icon={option.icon}
                      label={option.label}
                      onClick={() => setTheme(option.value)}
                    />
                  ))}
                </div>
              </SettingsRow>
            </SettingsSection>

            <SettingsSection title="Window">
              <SettingsRow label="X button">
                <div className="inline-flex w-fit items-center gap-1 rounded-xl border border-border/80 bg-muted/35 p-1">
                  {closeButtonOptions.map((option) => (
                    <SettingsChoiceButton
                      key={option.value}
                      active={closeButtonBehavior === option.value}
                      onClick={() => setCloseButtonBehavior(option.value)}
                    >
                      {option.label}
                    </SettingsChoiceButton>
                  ))}
                </div>
              </SettingsRow>
            </SettingsSection>
          </div>
        </SettingsDialogContent>
      </Dialog>
    </>
  )
}
