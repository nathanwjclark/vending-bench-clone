/**
 * Email tools: send and read emails.
 * send_email triggers supplier responses via the supplier LLM system.
 */

import {
  addToSent,
  formatEmailFull,
  formatEmailSummary,
  getUnreadEmails,
  markEmailRead,
} from "../simulation/email.js";
import { processSupplierEmail } from "../llm/supplier-llm.js";
import { DEFAULT_CONFIG } from "../config.js";
import { AGENT_EMAIL } from "../simulation/world.js";
import type { ToolDefinition } from "./types.js";

export const sendEmail: ToolDefinition = {
  name: "send_email",
  description:
    "Send an email to the specified address. Use this to contact suppliers, place orders, or negotiate prices.",
  parameters: {
    to: {
      type: "string",
      description: "The recipient email address.",
    },
    subject: {
      type: "string",
      description: "The email subject line.",
    },
    body: {
      type: "string",
      description: "The email body text.",
    },
  },
  timeCost: "digital",
  async execute(params, world) {
    const to = String(params["to"] ?? "");
    const subject = String(params["subject"] ?? "");
    const body = String(params["body"] ?? "");

    if (!to) return { output: "Error: 'to' address is required." };
    if (!subject) return { output: "Error: 'subject' is required." };
    if (!body) return { output: "Error: 'body' is required." };

    addToSent(world.email, {
      from: AGENT_EMAIL,
      to,
      subject,
      body,
      day: world.time.day,
    });

    // Trigger supplier response system
    const config = world.simulationConfig ?? DEFAULT_CONFIG;
    const result = await processSupplierEmail(to, subject, body, world, config, world.costTracker);

    if (result.isSupplier) {
      let msg = `Email sent to ${to} with subject "${subject}". This is a known supplier — check your inbox for a reply.`;

      if (result.orderPlaced && result.orderCost) {
        msg += `\n\nOrder processed! $${result.orderCost.toFixed(2)} has been charged. Remaining balance: $${world.balance.toFixed(2)}.`;
      } else if (result.orderPlaced === false && result.orderRejectedReason) {
        msg += `\n\nOrder NOT processed: ${result.orderRejectedReason}`;
      }

      return { output: msg };
    }

    return {
      output: `Email sent to ${to} with subject "${subject}". If this is a valid supplier address, you should receive a reply within 1-2 days.`,
    };
  },
};

export const readEmail: ToolDefinition = {
  name: "read_email",
  description:
    "Read your emails. Without an email_id, shows a summary of all emails. With an email_id, shows the full email content.",
  parameters: {
    email_id: {
      type: "string",
      description: "Optional: specific email ID to read in full.",
      required: false,
    },
  },
  timeCost: "digital",
  execute(params, world) {
    const emailId = params["email_id"] ? String(params["email_id"]) : undefined;
    const currentDay = world.time.day;

    if (emailId) {
      // Read specific email
      const email =
        world.email.inbox.find((e) => e.id === emailId && e.day <= currentDay) ??
        world.email.sent.find((e) => e.id === emailId);
      if (!email) {
        return { output: `Error: email "${emailId}" not found.` };
      }
      markEmailRead(world.email, emailId);
      return { output: formatEmailFull(email) };
    }

    // Show inbox summary (only emails that have arrived)
    const unread = getUnreadEmails(world.email, currentDay);
    const visibleInbox = world.email.inbox.filter((e) => e.day <= currentDay);
    const lines: string[] = [];

    if (unread.length > 0) {
      lines.push(`Unread Messages (${unread.length}):`);
      for (const email of unread) {
        lines.push(`  ${formatEmailSummary(email)}`);
      }
    }

    if (visibleInbox.length > 0) {
      lines.push(`\nAll Inbox (${visibleInbox.length} messages):`);
      // Show most recent 20
      const recent = visibleInbox.slice(-20);
      for (const email of recent) {
        lines.push(`  ${formatEmailSummary(email)}`);
      }
      if (visibleInbox.length > 20) {
        lines.push(`  ... and ${visibleInbox.length - 20} older messages`);
      }
    } else {
      lines.push("Inbox is empty.");
    }

    return { output: lines.join("\n") };
  },
};
