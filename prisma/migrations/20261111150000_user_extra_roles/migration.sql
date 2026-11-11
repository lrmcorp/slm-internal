-- Role tambahan per user (rangkap jabatan).
ALTER TABLE "User" ADD COLUMN "extraRoles" "Role"[] DEFAULT ARRAY[]::"Role"[];
