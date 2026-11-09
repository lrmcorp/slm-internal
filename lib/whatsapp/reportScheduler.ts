import "server-only";
import { listWhatsappRecipients, sendWhatsappMessage, summarizeWhatsappResults } from "./whatsappClient";
import { formatDailyReport, formatTempoReminderReport } from "./reportFormatter";
import { checkAllStockAlerts } from "@/lib/stockAlerts/scheduler";

export async function sendDailyReportJob() {
  const body = await formatDailyReport(new Date());
  const recipients = (await listWhatsappRecipients()).filter((recipient) => recipient.isActive && recipient.receivesDailyReport);
  const results = await Promise.allSettled(recipients.map((recipient) => sendWhatsappMessage(recipient, "daily_report", body)));
  return { ...summarizeWhatsappResults(results), skipped: recipients.length === 0 ? 1 : 0 };
}

export async function sendTempoReminderJob() {
  // Notifikasi HP dikirim terpisah dari WhatsApp, jadi tetap jalan walau WhatsApp belum diatur.
  const { notifyTempoDue } = await import("@/lib/push/notify");
  const push = await notifyTempoDue();
  const body = await formatTempoReminderReport(new Date());
  if (!body) return { sent: 0, failed: 0, skipped: 1, results: [], push };
  const recipients = (await listWhatsappRecipients()).filter((recipient) => recipient.isActive && recipient.receivesTempoReminder);
  const results = await Promise.allSettled(recipients.map((recipient) => sendWhatsappMessage(recipient, "tempo_reminder", body)));
  return { ...summarizeWhatsappResults(results), skipped: recipients.length === 0 ? 1 : 0, push };
}

export async function checkStockAlertJob() {
  return checkAllStockAlerts();
}
