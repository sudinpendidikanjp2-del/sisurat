-- CreateEnum
CREATE TYPE "LetterStatus" AS ENUM ('DRAFT', 'REGISTERED', 'AWAITING_DISPOSITION', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_REVIEW', 'NEEDS_REVISION', 'COMPLETED', 'ARCHIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'NEEDS_REVIEW', 'PROCESSING_FAILED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "Confidentiality" AS ENUM ('BIASA', 'TERBATAS', 'RAHASIA');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('RENDAH', 'NORMAL', 'TINGGI', 'SEGERA');

-- CreateEnum
CREATE TYPE "LetterType" AS ENUM ('UNDANGAN', 'PEMBERITAHUAN', 'PERMOHONAN', 'EDARAN', 'TUGAS', 'KETERANGAN', 'NOTA_DINAS', 'PENGANTAR', 'LAPORAN', 'LAINNYA');

-- CreateEnum
CREATE TYPE "DispositionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'WAITING_REVIEW', 'NEEDS_REVISION', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkUpdateType" AS ENUM ('STARTED', 'PROGRESS', 'SUBMITTED', 'APPROVED', 'REVISION_REQUESTED', 'CANCELLED', 'REASSIGNED');

-- CreateEnum
CREATE TYPE "OutgoingType" AS ENUM ('UNDANGAN', 'TUGAS', 'KETERANGAN', 'NOTA_DINAS', 'PENGANTAR');

-- CreateEnum
CREATE TYPE "OutgoingStatus" AS ENUM ('DRAFT', 'WAITING_REVIEW', 'NEEDS_REVISION', 'APPROVED', 'FINAL', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('GEMINI', 'CLAUDE', 'TESSERACT');

-- CreateEnum
CREATE TYPE "ExtractionMethod" AS ENUM ('LOCAL_TEXT', 'AI_TEXT', 'AI_VISION', 'LOCAL_OCR', 'MOCK');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('SOURCE', 'ATTACHMENT', 'EVIDENCE', 'GENERATED', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "CorrectionSource" AS ENUM ('VERIFICATION', 'POST_VERIFICATION_EDIT');

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "fullName" TEXT NOT NULL,
    "position" TEXT,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "unitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomingLetter" (
    "id" TEXT NOT NULL,
    "agendaNumber" TEXT,
    "agendaYear" INTEGER,
    "agendaSeq" INTEGER,
    "status" "LetterStatus" NOT NULL DEFAULT 'DRAFT',
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'UPLOADED',
    "confidentiality" "Confidentiality" NOT NULL DEFAULT 'BIASA',
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "letterType" "LetterType",
    "letterNumber" TEXT,
    "letterDate" DATE,
    "receivedDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "senderName" TEXT,
    "recipientName" TEXT,
    "subject" TEXT,
    "attachmentText" TEXT,
    "eventDate" DATE,
    "eventLocation" TEXT,
    "summary" TEXT,
    "category" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3),
    "forwardedToId" TEXT,
    "forwardedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IncomingLetter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "checksumSha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "incomingLetterId" TEXT,
    "workUpdateId" TEXT,
    "outgoingLetterId" TEXT,
    "templateId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionJob" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "incomingLetterId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "requestedById" TEXT,
    "provider" "AiProvider",
    "requestedProvider" "AiProvider",
    "method" "ExtractionMethod",
    "model" TEXT,
    "promptVersion" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "pagesProcessed" INTEGER,
    "estimatedCostUsd" DECIMAL(12,6),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionResult" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rawOutput" JSONB,
    "rawPurgedAt" TIMESTAMP(3),
    "extractedTextChars" INTEGER,
    "normalizedFields" JSONB NOT NULL,
    "reviewFlags" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetadataCorrection" (
    "id" TEXT NOT NULL,
    "incomingLetterId" TEXT NOT NULL,
    "extractionResultId" TEXT,
    "field" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "source" "CorrectionSource" NOT NULL,
    "correctedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetadataCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disposition" (
    "id" TEXT NOT NULL,
    "incomingLetterId" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "dueDate" DATE,
    "status" "DispositionStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Disposition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "dispositionId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "dueDate" DATE,
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "reassignedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkUpdate" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "type" "WorkUpdateType" NOT NULL,
    "note" TEXT,
    "progressPercent" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "type" "OutgoingType" NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "placeholders" JSONB NOT NULL,
    "activeFrom" DATE,
    "approvedByName" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutgoingLetter" (
    "id" TEXT NOT NULL,
    "type" "OutgoingType" NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "number" TEXT,
    "numberYear" INTEGER,
    "numberSeq" INTEGER,
    "subject" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "status" "OutgoingStatus" NOT NULL DEFAULT 'DRAFT',
    "confidentiality" "Confidentiality" NOT NULL DEFAULT 'BIASA',
    "dispositionId" TEXT,
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "finalizedById" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "OutgoingLetter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutgoingLetterLink" (
    "outgoingLetterId" TEXT NOT NULL,
    "incomingLetterId" TEXT NOT NULL,

    CONSTRAINT "OutgoingLetterLink_pkey" PRIMARY KEY ("outgoingLetterId","incomingLetterId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "link" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProviderConfig" (
    "provider" "AiProvider" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT NOT NULL,
    "approvedForExternal" BOOLEAN NOT NULL DEFAULT false,
    "allowedConfidentiality" "Confidentiality"[] DEFAULT ARRAY[]::"Confidentiality"[],
    "timeoutMs" INTEGER NOT NULL DEFAULT 60000,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "inputCostPerMTokUsd" DECIMAL(10,4),
    "outputCostPerMTokUsd" DECIMAL(10,4),
    "notes" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderConfig_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "NumberSequence" (
    "key" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("key","year")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "key" TEXT NOT NULL,
    "responseCode" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Unit_code_key" ON "Unit"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "IncomingLetter_agendaNumber_key" ON "IncomingLetter"("agendaNumber");

-- CreateIndex
CREATE INDEX "IncomingLetter_status_idx" ON "IncomingLetter"("status");

-- CreateIndex
CREATE INDEX "IncomingLetter_processingStatus_idx" ON "IncomingLetter"("processingStatus");

-- CreateIndex
CREATE INDEX "IncomingLetter_receivedDate_idx" ON "IncomingLetter"("receivedDate");

-- CreateIndex
CREATE INDEX "IncomingLetter_letterNumber_senderName_idx" ON "IncomingLetter"("letterNumber", "senderName");

-- CreateIndex
CREATE INDEX "IncomingLetter_forwardedToId_idx" ON "IncomingLetter"("forwardedToId");

-- CreateIndex
CREATE INDEX "IncomingLetter_createdById_idx" ON "IncomingLetter"("createdById");

-- CreateIndex
CREATE INDEX "IncomingLetter_deletedAt_idx" ON "IncomingLetter"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "Document_templateId_key" ON "Document"("templateId");

-- CreateIndex
CREATE INDEX "Document_incomingLetterId_idx" ON "Document"("incomingLetterId");

-- CreateIndex
CREATE INDEX "Document_workUpdateId_idx" ON "Document"("workUpdateId");

-- CreateIndex
CREATE INDEX "Document_outgoingLetterId_idx" ON "Document"("outgoingLetterId");

-- CreateIndex
CREATE INDEX "Document_checksumSha256_idx" ON "Document"("checksumSha256");

-- CreateIndex
CREATE INDEX "ExtractionJob_status_nextRunAt_idx" ON "ExtractionJob"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "ExtractionJob_documentId_idx" ON "ExtractionJob"("documentId");

-- CreateIndex
CREATE INDEX "ExtractionJob_incomingLetterId_idx" ON "ExtractionJob"("incomingLetterId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionResult_jobId_key" ON "ExtractionResult"("jobId");

-- CreateIndex
CREATE INDEX "MetadataCorrection_incomingLetterId_idx" ON "MetadataCorrection"("incomingLetterId");

-- CreateIndex
CREATE INDEX "MetadataCorrection_createdAt_idx" ON "MetadataCorrection"("createdAt");

-- CreateIndex
CREATE INDEX "Disposition_incomingLetterId_idx" ON "Disposition"("incomingLetterId");

-- CreateIndex
CREATE INDEX "Disposition_issuerId_idx" ON "Disposition"("issuerId");

-- CreateIndex
CREATE INDEX "Disposition_status_idx" ON "Disposition"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_reassignedFromId_key" ON "Assignment"("reassignedFromId");

-- CreateIndex
CREATE INDEX "Assignment_assigneeId_status_idx" ON "Assignment"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Assignment_dispositionId_idx" ON "Assignment"("dispositionId");

-- CreateIndex
CREATE INDEX "Assignment_dueDate_idx" ON "Assignment"("dueDate");

-- CreateIndex
CREATE INDEX "WorkUpdate_assignmentId_idx" ON "WorkUpdate"("assignmentId");

-- CreateIndex
CREATE INDEX "DocumentTemplate_type_isActive_idx" ON "DocumentTemplate"("type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplate_type_version_key" ON "DocumentTemplate"("type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "OutgoingLetter_number_key" ON "OutgoingLetter"("number");

-- CreateIndex
CREATE INDEX "OutgoingLetter_status_idx" ON "OutgoingLetter"("status");

-- CreateIndex
CREATE INDEX "OutgoingLetter_createdById_idx" ON "OutgoingLetter"("createdById");

-- CreateIndex
CREATE INDEX "OutgoingLetter_dispositionId_idx" ON "OutgoingLetter"("dispositionId");

-- CreateIndex
CREATE INDEX "OutgoingLetterLink_incomingLetterId_idx" ON "OutgoingLetterLink"("incomingLetterId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomingLetter" ADD CONSTRAINT "IncomingLetter_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomingLetter" ADD CONSTRAINT "IncomingLetter_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomingLetter" ADD CONSTRAINT "IncomingLetter_forwardedToId_fkey" FOREIGN KEY ("forwardedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_incomingLetterId_fkey" FOREIGN KEY ("incomingLetterId") REFERENCES "IncomingLetter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_workUpdateId_fkey" FOREIGN KEY ("workUpdateId") REFERENCES "WorkUpdate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_outgoingLetterId_fkey" FOREIGN KEY ("outgoingLetterId") REFERENCES "OutgoingLetter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionJob" ADD CONSTRAINT "ExtractionJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionJob" ADD CONSTRAINT "ExtractionJob_incomingLetterId_fkey" FOREIGN KEY ("incomingLetterId") REFERENCES "IncomingLetter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionJob" ADD CONSTRAINT "ExtractionJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionResult" ADD CONSTRAINT "ExtractionResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ExtractionJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionResult" ADD CONSTRAINT "ExtractionResult_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetadataCorrection" ADD CONSTRAINT "MetadataCorrection_incomingLetterId_fkey" FOREIGN KEY ("incomingLetterId") REFERENCES "IncomingLetter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetadataCorrection" ADD CONSTRAINT "MetadataCorrection_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disposition" ADD CONSTRAINT "Disposition_incomingLetterId_fkey" FOREIGN KEY ("incomingLetterId") REFERENCES "IncomingLetter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disposition" ADD CONSTRAINT "Disposition_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_dispositionId_fkey" FOREIGN KEY ("dispositionId") REFERENCES "Disposition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_reassignedFromId_fkey" FOREIGN KEY ("reassignedFromId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkUpdate" ADD CONSTRAINT "WorkUpdate_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkUpdate" ADD CONSTRAINT "WorkUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutgoingLetter" ADD CONSTRAINT "OutgoingLetter_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutgoingLetter" ADD CONSTRAINT "OutgoingLetter_dispositionId_fkey" FOREIGN KEY ("dispositionId") REFERENCES "Disposition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutgoingLetter" ADD CONSTRAINT "OutgoingLetter_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutgoingLetter" ADD CONSTRAINT "OutgoingLetter_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutgoingLetter" ADD CONSTRAINT "OutgoingLetter_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutgoingLetterLink" ADD CONSTRAINT "OutgoingLetterLink_outgoingLetterId_fkey" FOREIGN KEY ("outgoingLetterId") REFERENCES "OutgoingLetter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutgoingLetterLink" ADD CONSTRAINT "OutgoingLetterLink_incomingLetterId_fkey" FOREIGN KEY ("incomingLetterId") REFERENCES "IncomingLetter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
