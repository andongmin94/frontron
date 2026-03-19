import * as React from "react";
import { useEffect, useState } from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { Copy, Minus, Square, X } from "lucide-react";

import { cn } from "@/lib/utils";

import frontronLogo from "/logo.svg";

const BRIDGE_ERROR_TEXT = "Preload bridge missing";

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
  const electronApi =
    typeof window === "undefined" ? undefined : window.electron;
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!electronApi) {
      console.error(
        "[Frontron] window.electron is unavailable. Check the preload build output and BrowserWindow preload path.",
      );
      return;
    }

    electronApi
      .invoke?.("get-window-state")
      .then((s: { isMaximized: boolean }) => setIsMaximized(s.isMaximized))
      .catch(() => {});

    const off = electronApi.on?.("window-maximized-changed", (val: unknown) =>
      setIsMaximized(Boolean(val)),
    );

    return () => {
      if (typeof off === "function") off();
    };
  }, [electronApi]);

  const minimize = () => electronApi?.send("minimize");
  const toggleMaximize = () => electronApi?.send("toggle-maximize");
  const hidden = () => electronApi?.send("hidden");

  return (
    <>
      <div
        className={cn(
          "fixed top-0 left-0 right-0 flex w-full justify-between",
          electronApi ? "bg-neutral-800" : "bg-red-700",
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
          {electronApi ? (
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
              <Button onClick={hidden} size="icon">
                <X className="size-5" />
              </Button>
            </>
          ) : (
            <span className="px-3 text-xs font-medium text-white">
              {BRIDGE_ERROR_TEXT}
            </span>
          )}
        </div>
      </div>
      <div className="h-[40px]" />
    </>
  );
}
