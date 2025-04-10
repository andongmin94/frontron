import { useEffect, useState } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Copy, Minus, Square, X } from "lucide-react";

import { cn } from "@/lib/utils";

import frontronLogo from "/frontron.svg";

const buttonVariants = cva(
  "inline-flex items-center hover:bg-gray-700 hover:cursor-pointer justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
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

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [ipcRenderer, setIpcRenderer] = useState<any>(null);

  // 컴포넌트 마운트시 한 번만 ipcRenderer 가져오기
  useEffect(() => {
    setIpcRenderer(require("electron").ipcRenderer);
  }, []);

  const minimize = () => {
    ipcRenderer.send("minimize");
  };

  const maximize = () => {
    ipcRenderer.send("maximize");
    setIsMaximized(!isMaximized);
  };

  const hidden = () => {
    ipcRenderer.send("hidden");
  };

  return (
    <>
      <div
        className="fixed flex w-full justify-between bg-neutral-800"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="flex items-center pl-2">
          <img src={frontronLogo} alt="Frontron" className="size-6" />
          &nbsp;&nbsp;
          <span className="text-lg text-white">Frontron</span>
        </div>
        <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <Button onClick={minimize} size="icon">
            <Minus className="size-6" />
          </Button>
          &nbsp;
          <Button onClick={maximize} size="icon">
            {isMaximized ? (
              <Copy className="size-6" />
            ) : (
              <Square className="size-6" />
            )}
          </Button>
          &nbsp;
          <Button onClick={hidden} size="icon">
            <X className="size-6" />
          </Button>
        </div>
      </div>

      <div className="h-[40px]" />
    </>
  );
}
