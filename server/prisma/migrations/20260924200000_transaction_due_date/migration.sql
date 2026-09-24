-- AlterTable
-- When money lent to or borrowed from a person is expected back.
ALTER TABLE "Transaction" ADD COLUMN     "dueDate" TIMESTAMP(3);
