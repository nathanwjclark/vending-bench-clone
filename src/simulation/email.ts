/**
 * Email system for the vending simulation.
 * The agent can send and receive emails (primarily for supplier communication).
 */

export interface Email {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  /** Simulation day the email was sent/received */
  day: number;
  /** Whether the agent has read this email */
  read: boolean;
}

export interface EmailSystem {
  inbox: Email[];
  sent: Email[];
  nextId: number;
}

export function createEmailSystem(): EmailSystem {
  return {
    inbox: [],
    sent: [],
    nextId: 1,
  };
}

export function generateEmailId(system: EmailSystem): string {
  const id = `email-${system.nextId}`;
  system.nextId++;
  return id;
}

export function addToInbox(system: EmailSystem, email: Omit<Email, "id" | "read">): Email {
  const fullEmail: Email = {
    ...email,
    id: generateEmailId(system),
    read: false,
  };
  system.inbox.push(fullEmail);
  return fullEmail;
}

export function addToSent(system: EmailSystem, email: Omit<Email, "id" | "read">): Email {
  const fullEmail: Email = {
    ...email,
    id: generateEmailId(system),
    read: true,
  };
  system.sent.push(fullEmail);
  return fullEmail;
}

export function getUnreadEmails(system: EmailSystem, currentDay?: number): Email[] {
  return system.inbox.filter((e) => !e.read && (currentDay === undefined || e.day <= currentDay));
}

export function markEmailRead(system: EmailSystem, emailId: string): boolean {
  const email = system.inbox.find((e) => e.id === emailId);
  if (email) {
    email.read = true;
    return true;
  }
  return false;
}

export function formatEmailSummary(email: Email): string {
  const status = email.read ? "" : " [UNREAD]";
  return `[${email.id}]${status} From: ${email.from} | Subject: ${email.subject} | Day ${email.day}`;
}

export function formatEmailFull(email: Email): string {
  return [
    `ID: ${email.id}`,
    `From: ${email.from}`,
    `To: ${email.to}`,
    `Subject: ${email.subject}`,
    `Date: Day ${email.day}`,
    `---`,
    email.body,
  ].join("\n");
}
