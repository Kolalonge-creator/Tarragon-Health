"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { uploadPatientAvatar } from "./actions";
import { PATIENT_AVATAR_ACCEPT, validatePatientAvatarFile } from "@/lib/validation/patient-avatar";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Lets a patient set their own profile photo. Self-upload only (mirrors
 * PatientResultUpload) — a real photo, or the shared initials fallback when
 * none is set, everywhere Avatar is used (the header, sidebar, and the
 * clinician-facing patient monitoring grid). */
export function AvatarUploadForm({
  fullName,
  avatarUrl,
}: {
  fullName: string;
  avatarUrl: string | null;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a photo first.");
      const formData = new FormData();
      formData.set("file", file);
      const result = await uploadPatientAvatar(formData);
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      setSuccess("Photo updated.");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    },
  });

  function handleFileChange(selected: File | null) {
    setFile(selected);
    setValidationError(null);
    setSuccess(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(selected ? URL.createObjectURL(selected) : null);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    setValidationError(null);
    if (file) {
      const fileError = validatePatientAvatarFile(file);
      if (fileError) {
        setValidationError(fileError);
        return;
      }
    }
    upload.mutate();
  }

  const displayError = validationError ?? (upload.error as Error | null)?.message ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Profile photo</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex items-center gap-4">
          <Avatar fullName={fullName} photoUrl={preview ?? avatarUrl} size="xl" />
          <div className="flex-1 space-y-1.5">
            <Label htmlFor={`${fieldId}-file`} className="text-xs">
              Upload a new photo
            </Label>
            <Input
              id={`${fieldId}-file`}
              ref={fileInputRef}
              type="file"
              accept={PATIENT_AVATAR_ACCEPT}
              onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">JPG, PNG, or WEBP, up to 5 MB.</p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button type="submit" size="sm" variant="outline" disabled={!file || upload.isPending}>
                {upload.isPending ? "Saving…" : "Save photo"}
              </Button>
              {success && <p className="text-xs font-medium text-brand-green dark:text-brand-green-bright">{success}</p>}
              {displayError && <p className="text-xs text-red-600 dark:text-red-300">{displayError}</p>}
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
