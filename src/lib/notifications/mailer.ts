import net from "node:net";
import tls from "node:tls";

export type SendEmailInput = {
  to: string | null | undefined;
  subject: string;
  body: string;
};

export type SendEmailResult =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const config = smtpConfig(input.to);
  if (!config) return { status: "skipped", reason: "SMTP is not configured." };

  try {
    await sendSmtp({
      ...config,
      subject: input.subject,
      body: input.body
    });
    return { status: "sent" };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

function smtpConfig(to: string | null | undefined) {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || "465");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.NOTIFICATION_EMAIL_FROM || user;
  const recipient = to || process.env.NOTIFICATION_EMAIL_TO;

  if (!host || !port || !user || !pass || !from || !recipient) return null;

  return {
    host,
    port,
    secure: port === 465,
    user,
    pass,
    from,
    to: recipient
  };
}

async function sendSmtp(input: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string;
  subject: string;
  body: string;
}) {
  const socket = input.secure
    ? tls.connect({ host: input.host, port: input.port, servername: input.host })
    : net.connect({ host: input.host, port: input.port });

  const client = new SmtpClient(socket);
  await client.expect(220);
  await client.command(`EHLO ${input.host}`, 250);

  if (!input.secure) {
    await client.command("STARTTLS", 220);
    await client.upgrade(input.host);
    await client.command(`EHLO ${input.host}`, 250);
  }

  await client.command("AUTH LOGIN", 334);
  await client.command(Buffer.from(input.user).toString("base64"), 334);
  await client.command(Buffer.from(input.pass).toString("base64"), 235);
  await client.command(`MAIL FROM:<${input.from}>`, 250);
  await client.command(`RCPT TO:<${input.to}>`, 250);
  await client.command("DATA", 354);
  await client.writeData(formatMessage(input));
  await client.expect(250);
  await client.command("QUIT", 221);
  client.close();
}

function formatMessage(input: { from: string; to: string; subject: string; body: string }) {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(input.subject, "utf8").toString("base64")}?=`;
  const lines = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    input.body,
    "."
  ];

  return `${lines.join("\r\n")}\r\n`;
}

class SmtpClient {
  private buffer = "";

  constructor(private socket: net.Socket | tls.TLSSocket) {
    this.socket.setEncoding("utf8");
  }

  async expect(code: number) {
    const response = await this.readResponse();
    if (!response.startsWith(String(code))) throw new Error(`SMTP expected ${code}, got ${response}`);
  }

  async command(command: string, expected: number) {
    this.socket.write(`${command}\r\n`);
    await this.expect(expected);
  }

  async writeData(data: string) {
    this.socket.write(data);
  }

  async upgrade(host: string) {
    const upgraded = tls.connect({ socket: this.socket, servername: host });
    this.socket = upgraded;
    this.socket.setEncoding("utf8");
    await new Promise<void>((resolve, reject) => {
      upgraded.once("secureConnect", resolve);
      upgraded.once("error", reject);
    });
  }

  close() {
    this.socket.end();
  }

  private readResponse() {
    return new Promise<string>((resolve, reject) => {
      const onData = (chunk: string) => {
        this.buffer += chunk;
        const lines = this.buffer.split(/\r?\n/).filter(Boolean);
        const last = lines.at(-1);
        if (last && /^\d{3} /.test(last)) {
          cleanup();
          const response = this.buffer.trim();
          this.buffer = "";
          resolve(response);
        }
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        this.socket.off("data", onData);
        this.socket.off("error", onError);
      };
      this.socket.on("data", onData);
      this.socket.once("error", onError);
    });
  }
}
