type EmailData = Record<string, any>;

type EmailContent = {
  html: string;
  text: string;
};

export const buildEmailContent = (
  type: string,
  data: EmailData,
): EmailContent => {
  switch (type) {
    case "booking_confirmation":
      return {
        html: generateBookingConfirmationHTML(data),
        text: generateBookingConfirmationText(data),
      };
    case "booking_reminder":
      return {
        html: generateBookingReminderHTML(data),
        text: generateBookingReminderText(data),
      };
    case "booking_status_update":
      return {
        html: generateStatusUpdateHTML(data),
        text: generateStatusUpdateText(data),
      };
    default:
      throw new Error("Unknown email type");
  }
};

function generateBookingConfirmationHTML(data: EmailData) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Confirmação de Agendamento</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #3B82F6, #8B5CF6); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }
            .booking-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
            .detail-label { font-weight: bold; color: #64748b; }
            .detail-value { color: #1e293b; }
            .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
            .button { background: linear-gradient(135deg, #3B82F6, #8B5CF6); color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 20px 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>✅ Agendamento Confirmado!</h1>
                <p>Seu agendamento foi registrado com sucesso</p>
            </div>
            <div class="content">
                <p>Olá <strong>${data.client_name}</strong>,</p>
                <p>Seu agendamento com <strong>${data.company_name}</strong> foi confirmado com sucesso!</p>
                
                <div class="booking-details">
                    <h3>📋 Detalhes do Agendamento</h3>
                    <div class="detail-row">
                        <span class="detail-label">Serviço:</span>
                        <span class="detail-value">${data.service}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Data:</span>
                        <span class="detail-value">${new Date(data.booking_date).toLocaleDateString("pt-BR")}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Horário:</span>
                        <span class="detail-value">${data.booking_time}</span>
                    </div>
                    ${
                      data.attendant_name
                        ? `
                    <div class="detail-row">
                        <span class="detail-label">Atendente:</span>
                        <span class="detail-value">${data.attendant_name}</span>
                    </div>
                    `
                        : ""
                    }
                    <div class="detail-row">
                        <span class="detail-label">Empresa:</span>
                        <span class="detail-value">${data.company_name}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Telefone:</span>
                        <span class="detail-value">${data.company_phone}</span>
                    </div>
                </div>

                <p><strong>📞 Precisa reagendar?</strong><br>
                Entre em contato conosco pelo telefone <strong>${data.company_phone}</strong></p>

                <p><strong>⏰ Lembrete:</strong><br>
                Chegue com 10 minutos de antecedência para seu atendimento.</p>
            </div>
            <div class="footer">
                <p>Este é um email automático do sistema AlignPro.</p>
                <p>© 2024 AlignPro - Todos os direitos reservados</p>
            </div>
        </div>
    </body>
    </html>
  `;
}

function generateBookingConfirmationText(data: EmailData) {
  return `
AGENDAMENTO CONFIRMADO!

Olá ${data.client_name},

Seu agendamento com ${data.company_name} foi confirmado com sucesso!

DETALHES DO AGENDAMENTO:
- Serviço: ${data.service}
- Data: ${new Date(data.booking_date).toLocaleDateString("pt-BR")}
- Horário: ${data.booking_time}
${data.attendant_name ? `- Atendente: ${data.attendant_name}` : ""}
- Empresa: ${data.company_name}
- Telefone: ${data.company_phone}

PRECISA REAGENDAR?
Entre em contato conosco pelo telefone ${data.company_phone}

LEMBRETE:
Chegue com 10 minutos de antecedência para seu atendimento.

---
Este é um email automático do sistema AlignPro.
© 2024 AlignPro - Todos os direitos reservados
  `;
}

function generateBookingReminderHTML(data: EmailData) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Lembrete de Agendamento</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #F59E0B, #EF4444); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #fef3c7; padding: 30px; border-radius: 0 0 8px 8px; }
            .booking-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
            .detail-label { font-weight: bold; color: #64748b; }
            .detail-value { color: #1e293b; }
            .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
            .alert { background: #fef2f2; border: 1px solid #fecaca; padding: 15px; border-radius: 6px; margin: 20px 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>⏰ Lembrete de Agendamento</h1>
                <p>Seu agendamento é amanhã!</p>
            </div>
            <div class="content">
                <p>Olá <strong>${data.client_name}</strong>,</p>
                
                <div class="alert">
                    <strong>🔔 Lembrete:</strong> Você tem um agendamento marcado para amanhã com <strong>${data.company_name}</strong>
                </div>
                
                <div class="booking-details">
                    <h3>📋 Detalhes do Agendamento</h3>
                    <div class="detail-row">
                        <span class="detail-label">Serviço:</span>
                        <span class="detail-value">${data.service}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Data:</span>
                        <span class="detail-value">${new Date(data.booking_date).toLocaleDateString("pt-BR")}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Horário:</span>
                        <span class="detail-value">${data.booking_time}</span>
                    </div>
                    ${
                      data.attendant_name
                        ? `
                    <div class="detail-row">
                        <span class="detail-label">Atendente:</span>
                        <span class="detail-value">${data.attendant_name}</span>
                    </div>
                    `
                        : ""
                    }
                </div>

                <p><strong>📞 Precisa reagendar?</strong><br>
                Entre em contato conosco pelo telefone <strong>${data.company_phone}</strong></p>
            </div>
            <div class="footer">
                <p>Este é um email automático do sistema AgendaPro.</p>
            </div>
        </div>
    </body>
    </html>
  `;
}

function generateBookingReminderText(data: EmailData) {
  return `
LEMBRETE DE AGENDAMENTO

Olá ${data.client_name},

🔔 Lembrete: Você tem um agendamento marcado para amanhã com ${data.company_name}

DETALHES:
- Serviço: ${data.service}
- Data: ${new Date(data.booking_date).toLocaleDateString("pt-BR")}
- Horário: ${data.booking_time}
${data.attendant_name ? `- Atendente: ${data.attendant_name}` : ""}

PRECISA REAGENDAR?
Entre em contato: ${data.company_phone}

---
Este é um email automático do sistema AgendaPro.
  `;
}

function generateStatusUpdateHTML(data: EmailData) {
  const statusLabels: Record<string, string> = {
    confirmed: "Confirmado",
    in_progress: "Em Andamento",
    completed: "Concluído",
    cancelled: "Cancelado",
    no_show: "Não Compareceu",
  };

  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Atualização de Agendamento</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #10B981, #059669); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f0fdf4; padding: 30px; border-radius: 0 0 8px 8px; }
            .status { background: #fff; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; font-size: 18px; }
            .booking-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
            .detail-label { font-weight: bold; color: #64748b; }
            .detail-value { color: #1e293b; }
            .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>📢 Atualização de Agendamento</h1>
                <p>Seu agendamento teve o status atualizado</p>
            </div>
            <div class="content">
                <p>Olá <strong>${data.client_name}</strong>,</p>
                <div class="status">
                    <strong>Status:</strong> ${statusLabels[data.status] || data.status}
                </div>
                <div class="booking-details">
                    <h3>📋 Detalhes do Agendamento</h3>
                    <div class="detail-row">
                        <span class="detail-label">Serviço:</span>
                        <span class="detail-value">${data.service}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Data:</span>
                        <span class="detail-value">${new Date(data.booking_date).toLocaleDateString("pt-BR")}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Horário:</span>
                        <span class="detail-value">${data.booking_time}</span>
                    </div>
                    ${
                      data.attendant_name
                        ? `
                    <div class="detail-row">
                        <span class="detail-label">Atendente:</span>
                        <span class="detail-value">${data.attendant_name}</span>
                    </div>
                    `
                        : ""
                    }
                </div>
            </div>
            <div class="footer">
                <p>Este é um email automático do sistema AgendaPro.</p>
            </div>
        </div>
    </body>
    </html>
  `;
}

function generateStatusUpdateText(data: EmailData) {
  const statusLabels: Record<string, string> = {
    confirmed: "Confirmado",
    in_progress: "Em Andamento",
    completed: "Concluído",
    cancelled: "Cancelado",
    no_show: "Não Compareceu",
  };

  return `
ATUALIZAÇÃO DE AGENDAMENTO

Olá ${data.client_name},

Status atualizado: ${statusLabels[data.status] || data.status}

DETALHES:
- Serviço: ${data.service}
- Data: ${new Date(data.booking_date).toLocaleDateString("pt-BR")}
- Horário: ${data.booking_time}
${data.attendant_name ? `- Atendente: ${data.attendant_name}` : ""}

---
Este é um email automático do sistema AgendaPro.
  `;
}
