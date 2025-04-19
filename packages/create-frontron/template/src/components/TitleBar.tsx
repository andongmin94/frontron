import { useEffect, useState } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Copy, Minus, Square, X } from "lucide-react";

import { cn } from "@/lib/utils";

import frontronLogo from "/frontron.svg";

const buttonVariants = cva(
  "inline-flex items-center hover:cursor-pointer justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-neutral-800 text-primary-foreground shadow-xs hover:bg-neutral-700",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

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
