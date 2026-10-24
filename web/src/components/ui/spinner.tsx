import { cn } from "cn"
import { LoaderCircleIcon } from "lucide-react"

// Inherits the text colour. Pass `aria-label` (from the copy) when it stands alone; otherwise it is decorative.
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const label = props["aria-label"]
  return (
    <LoaderCircleIcon
      data-slot="spinner"
      strokeWidth={1.75}
      role={label ? "status" : undefined}
      aria-hidden={label ? undefined : true}
      className={cn("size-4 animate-spin motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Spinner }
