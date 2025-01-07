"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Copy, Minus, Square, X } from "lucide-react";

import { cn } from "@/lib/utils";

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
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

type ElectronApi = {
  send: (channel: string, data?: unknown) => void;
  invoke?: (channel: string, ...args: unknown[]) => Promise<any>;
  on?: (
    channel: string,
    listener: (...args: unknown[]) => void,
  ) => (() => void) | void;
};

type WindowWithElectron = Window & {
  electron?: ElectronApi;
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [electronApi, setElectronApi] = useState<ElectronApi | null>(null);

  useEffect(() => {
    setElectronApi((window as WindowWithElectron).electron ?? null);
  }, []);

  useEffect(() => {
    if (!electronApi) return;

    electronApi
      .invoke?.("get-window-state")
      .then((state: { isMaximized: boolean }) =>
        setIsMaximized(state.isMaximized),
      )
      .catch(() => {});

    const off = electronApi.on?.("window-maximized-changed", (val: unknown) => {
      setIsMaximized(Boolean(val));
    });

    return () => {
      if (typeof off === "function") off();
    };
  }, [electronApi]);

  const minimize = () => electronApi?.send("minimize");
  const toggleMaximize = () => electronApi?.send("toggle-maximize");
  const hidden = () => electronApi?.send("hidden");

  return (
    <>
      {electronApi && (
        <div
          className="fixed top-0 left-0 right-0 flex w-full justify-between bg-neutral-800"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <div className="flex items-center pl-2 select-none">
            <img src="/logo.svg" alt="mini-cast" className="size-6" />
            <span className="ml-2 text-lg text-white">Frontron</span>
          </div>
          <div
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            className="flex items-center"
          >
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
          </div>
        </div>
      )}
    </>
  );
}
