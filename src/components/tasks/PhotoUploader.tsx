"use client";

import { Camera, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUploadThing } from "@/lib/uploadthing";
import { cn } from "@/lib/utils";

export interface UploadedFile {
  url: string;
  key: string;
  name: string;
}

interface ExistingItem {
  id: string;
  url: string;
  name?: string;
  kind?: "image" | "document";
}

interface PhotoUploaderProps {
  label: string;
  items: ExistingItem[];
  max: number;
  /** Images only (photos) or images + PDFs (quotes, receipts). */
  accept?: "images" | "documents";
  disabled?: boolean;
  disabledReason?: string;
  onUploaded: (file: UploadedFile) => Promise<void> | void;
  onRemove?: (id: string) => Promise<void> | void;
}

/**
 * Upload strip for task photos and documents. On phones the photo picker
 * offers the camera directly. Limits are shown and enforced before upload;
 * the server enforces them again.
 */
export function PhotoUploader({
  label,
  items,
  max,
  accept = "images",
  disabled,
  disabledReason,
  onUploaded,
  onRemove,
}: PhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const remaining = Math.max(0, max - items.length);
  const { startUpload, isUploading } = useUploadThing("taskMedia", {
    onUploadError: (error) => {
      toast.error(error.message || "Upload failed");
    },
  });

  const pick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const chosen = Array.from(files).slice(0, remaining);
    if (files.length > remaining) toast.info(`Only ${remaining} more can be added`);
    const result = await startUpload(chosen);
    for (const file of result ?? []) {
      try {
        await onUploaded({ url: file.ufsUrl, key: file.key, name: file.name });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not attach the file");
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const remove = async (id: string) => {
    if (!onRemove) return;
    setBusyId(id);
    try {
      await onRemove(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the file");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {label}{" "}
          <span className="font-normal text-muted-foreground">
            ({items.length}/{max})
          </span>
        </p>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          aria-label={`Add ${label.toLowerCase()}`}
          accept={accept === "images" ? "image/*" : "image/*,application/pdf"}
          multiple={remaining > 1}
          capture={accept === "images" ? "environment" : undefined}
          onChange={(e) => void pick(e.target.files)}
          disabled={disabled || isUploading || remaining === 0}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={disabled || isUploading || remaining === 0}
          title={disabled ? disabledReason : undefined}
          onClick={() => inputRef.current?.click()}
        >
          {isUploading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : accept === "images" ? (
            <Camera className="mr-1.5 h-3.5 w-3.5" />
          ) : (
            <Upload className="mr-1.5 h-3.5 w-3.5" />
          )}
          {isUploading ? "Uploading…" : "Add"}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          {disabled && disabledReason ? disabledReason : "Nothing added yet."}
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="group relative overflow-hidden rounded-xl border border-border bg-muted"
            >
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block aspect-square"
              >
                {item.kind === "document" ? (
                  <span className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center text-[11px] text-muted-foreground">
                    <FileText className="h-6 w-6" aria-hidden="true" />
                    <span className="line-clamp-2 break-all">{item.name || "Document"}</span>
                  </span>
                ) : (
                  // biome-ignore lint/performance/noImgElement: user uploads from an external CDN at arbitrary sizes
                  <img
                    src={item.url}
                    alt={item.name || label}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                )}
              </a>
              {onRemove && !disabled ? (
                <button
                  type="button"
                  aria-label={`Remove ${item.name || "file"}`}
                  onClick={() => void remove(item.id)}
                  disabled={busyId === item.id}
                  className={cn(
                    "absolute right-1 top-1 rounded-full bg-background/90 p-1 text-destructive shadow-sm transition-opacity",
                    "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100",
                  )}
                >
                  {busyId === item.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
