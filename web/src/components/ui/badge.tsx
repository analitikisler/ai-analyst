import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Tags (Çini `.tag`, Overt Badge tones): status tones always pair with a word or a glyph.
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border px-1.5 text-2xs font-medium whitespace-nowrap transition-colors has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "border-border bg-surface-2 text-subtle",
        secondary: "border-border bg-surface-2 text-subtle",
        primary: "border-border-strong bg-surface-2 text-strong",
        success: "border-ok/40 bg-ok-soft text-ok",
        warning: "border-warn/40 bg-warn-soft text-warn",
        destructive: "border-bad/40 bg-bad-soft text-bad",
        info: "border-info/40 bg-info-soft text-info",
        outline: "border-border-strong text-subtle",
        ghost: "border-transparent text-subtle",
        link: "border-transparent text-link underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
