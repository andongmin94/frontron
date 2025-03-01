import * as React from "react";
import { useEffect, useState } from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { Copy, Minus, Square, X } from "lucide-react";

import { bridge } from "frontron/client";

import { cn, hasDesktopBridgeRuntime } from "@/lib/utils";

import frontronLogo from "/logo.svg";

const WEB_PREVIEW_TEXT = "Web preview";
const BRIDGE_CHECKING_TEXT = "Connecting desktop bridge...";
const BRIDGE_ERROR_TEXT = "Desktop bridge unavailable";

const buttonVariants = cva(
  "inline-flex items-center hover:cursor-pointer justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-neutral-800 text-primary-foreground hover:bg-neutral-700",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-red-600",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);

export default function TitleBar() {
  const hasDesktopBridge = hasDesktopBridgeRuntime();
  const [bridgeMode, setBridgeMode] = useState<"checking" | "desktop" | "preview" | "error">(
    hasDesktopBridge ? "checking" : "preview",
  );
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!hasDesktopBridge) {
      return undefined;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    async function connectWindowBridge() {
      try {
        unsubscribe = bridge.window.onMaximizedChanged((value: unknown) => {
          if (cancelled) {
            return;
          }

          setBridgeMode("desktop");
          setIsMaximized(Boolean(value));
        }) as (() => void) | undefined;

        const state = await bridge.window.getState();
        const nextState = state as { isMaximized?: boolean };

        if (cancelled) {
          return;
        }

        setBridgeMode("desktop");
        setIsMaximized(Boolean(nextState.isMaximized));
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("[Frontron] Failed to connect the desktop bridge.", error);
        setBridgeMode("error");
      }
    }

    void connectWindowBridge();

    return () => {
      cancelled = true;
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [hasDesktopBridge]);

  const runWindowAction = (label: string, action: () => Promise<unknown>) => {
    void action().catch((error: unknown) => {
      console.error(`[Frontron] Failed to ${label}.`, error);
      setBridgeMode("error");
    });
  };

  const minimize = () => {
    runWindowAction("minimize the window", () => bridge.window.minimize());
  };

  const toggleMaximize = () => {
    runWindowAction("toggle maximize", () => bridge.window.toggleMaximize());
  };

  const hideWindow = () => {
    runWindowAction("hide the window", () => bridge.window.hide());
  };

  return (
    <>
      <div
        className={cn(
          "fixed top-0 left-0 right-0 flex w-full justify-between",
          bridgeMode === "error" ? "bg-red-700" : "bg-neutral-800",
        )}
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="flex items-center pl-2 select-none">
          <img src={frontronLogo} alt="Frontron" className="size-6" />
          <span className="ml-2 text-lg text-white">Frontron</span>
        </div>
        <div
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className="flex items-center"
        >
          {bridgeMode === "desktop" ? (
            <>
              <Button onClick={minimize} size="icon">
                <Minus className="size-5" />
              </Button>
              <Button onClick={toggleMaximize} size="icon">
                {isMaximized ? (
                  <Copy className="size-5" />
                ) : (
                  <Square className="size-5" />
                )}
              </Button>
              <Button onClick={hideWindow} size="icon">
                <X className="size-5" />
              </Button>
            </>
          ) : (
            <span className="px-3 text-xs font-medium text-white">
              {bridgeMode === "preview"
                ? WEB_PREVIEW_TEXT
                : bridgeMode === "checking"
                  ? BRIDGE_CHECKING_TEXT
                  : BRIDGE_ERROR_TEXT}
            </span>
          )}
        </div>
      </div>
      <div className="h-[40px]" />
    </>
  );
}
