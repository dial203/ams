import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";

export function CopyButton({
  value,
  label = "Copy",
  showLabel = false,
  ...props
}: { value: string; label?: string; showLabel?: boolean } & Omit<ButtonProps, "value" | "onClick">) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size={showLabel ? "sm" : "icon-sm"}
      aria-label={label}
      title={label}
      onClick={async () => {
        if (await copyText(value)) {
          setCopied(true);
          toast.success("Copied to clipboard");
          setTimeout(() => setCopied(false), 1500);
        } else {
          toast.error("Could not copy");
        }
      }}
      {...props}
    >
      {copied ? <Check /> : <Copy />}
      {showLabel && <span>{label}</span>}
    </Button>
  );
}
