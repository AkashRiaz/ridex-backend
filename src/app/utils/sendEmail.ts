import path from "node:path";
import ejs from "ejs";
import { config } from "../config";
import { isSmtpConfigured, transporter } from "../lib/nodemailer";

type TSendEmailPayload = {
  to: string;
  subject: string;
  template: string; // file name in src/app/templates without .ejs
  data: Record<string, unknown>;
};

/*
 * Same ejs.renderFile + transporter.sendMail flow as the reference,
 * in one place. Every template receives appName automatically.
 */
export const sendEmail = async ({
  to,
  subject,
  template,
  data,
}: TSendEmailPayload) => {
  const templatePath = path.join(
    process.cwd(),
    `src/app/templates/${template}.ejs`,
  );

  const html = await ejs.renderFile(templatePath, {
    appName: config.app_name,
    frontendUrl: config.frontend_url,
    ...data,
  });

  if (!isSmtpConfigured) {
    console.warn(`SMTP not configured. Skipped email "${subject}" to ${to}`);
    return;
  }

  await transporter.sendMail({
    from: `"${config.app_name}" <${config.smtp_user}>`,
    to,
    subject,
    html,
  });
};
