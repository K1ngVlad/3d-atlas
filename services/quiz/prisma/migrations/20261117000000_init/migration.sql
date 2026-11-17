-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "quizzes" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "manifest_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "quiz_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "manifest_id" TEXT,
    "part_id" TEXT,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_options" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL,

    CONSTRAINT "answer_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempts" (
    "id" UUID NOT NULL,
    "quiz_id" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "participant_name" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "score" INTEGER,
    "total" INTEGER NOT NULL,

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_answers" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "answered_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attempt_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_answer_options" (
    "attempt_answer_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,

    CONSTRAINT "attempt_answer_options_pkey" PRIMARY KEY ("attempt_answer_id","option_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "questions_quiz_id_position_key" ON "questions"("quiz_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "answer_options_question_id_position_key" ON "answer_options"("question_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_answers_attempt_id_question_id_key" ON "attempt_answers"("attempt_id", "question_id");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_options" ADD CONSTRAINT "answer_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_answer_options" ADD CONSTRAINT "attempt_answer_options_attempt_answer_id_fkey" FOREIGN KEY ("attempt_answer_id") REFERENCES "attempt_answers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_answer_options" ADD CONSTRAINT "attempt_answer_options_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "answer_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

