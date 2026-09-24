-- AlterEnum
-- A PERSON account is a running tab with one friend or relative: money lent to them or borrowed
-- from them moves as transfers, so it never counts as income or expense.
ALTER TYPE "AccountType" ADD VALUE 'PERSON';
