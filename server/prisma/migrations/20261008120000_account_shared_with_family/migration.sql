-- A personal account its owner shares (read-only) with the rest of the family.
ALTER TABLE "Account" ADD COLUMN "sharedWithFamily" BOOLEAN NOT NULL DEFAULT false;
