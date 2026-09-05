-- ==============================================================================
-- SCHEMA DO SUPABASE: SISTEMA DE RIFA BENEFICENTE (0 A 600)
-- Cole este script no SQL Editor do Supabase (Dashboard -> SQL Editor -> New query -> Run)
-- ==============================================================================

-- 1. Tabela de Configurações da Rifa
CREATE TABLE IF NOT EXISTS raffle_settings (
    id INT PRIMARY KEY DEFAULT 1,
    title TEXT NOT NULL DEFAULT 'Rifa Beneficente',
    description TEXT NOT NULL DEFAULT 'Ajude nossa causa solidária! Cada número adquirido faz toda a diferença para o nosso projeto beneficente.',
    prize TEXT NOT NULL DEFAULT 'Smartphone de Última Geração ou R$ 3.000,00 no PIX',
    price_per_number NUMERIC(10, 2) NOT NULL DEFAULT 10.00,
    min_number INT NOT NULL DEFAULT 0,
    max_number INT NOT NULL DEFAULT 600,
    reservation_timeout_minutes INT NOT NULL DEFAULT 15,
    asaas_api_key TEXT DEFAULT '',
    asaas_environment TEXT DEFAULT 'sandbox', -- 'sandbox' ou 'production'
    asaas_webhook_token TEXT DEFAULT '',
    evolution_api_url TEXT DEFAULT '',
    evolution_api_key TEXT DEFAULT '',
    evolution_instance TEXT DEFAULT '',
    admin_password TEXT DEFAULT 'admin123',
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Inserir configurações padrão caso não existam
INSERT INTO raffle_settings (id, title, description, prize, price_per_number, min_number, max_number)
VALUES (1, 'Rifa Solidária Beneficente', 'Participe da nossa rifa beneficente em prol das nossas ações solidárias. Concorra ao prêmio e nos ajude a transformar vidas!', 'iPhone 15 ou R$ 3.500 no PIX', 10.00, 0, 600)
ON CONFLICT (id) DO NOTHING;

-- 2. Tabela de Pedidos / Compras
CREATE TABLE IF NOT EXISTS raffle_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_cpf TEXT NOT NULL,
    customer_email TEXT,
    total_amount NUMERIC(10, 2) NOT NULL,
    numbers_count INT NOT NULL,
    selected_numbers TEXT[] NOT NULL,
    asaas_payment_id TEXT,
    asaas_invoice_url TEXT,
    pix_qr_code TEXT,
    pix_code TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'paid', 'expired', 'cancelled'
    whatsapp_notified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    expires_at TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ
);

-- Índices para consultas rápidas
CREATE INDEX IF NOT EXISTS idx_orders_status ON raffle_orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON raffle_orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_cpf ON raffle_orders(customer_cpf);
CREATE INDEX IF NOT EXISTS idx_orders_asaas_id ON raffle_orders(asaas_payment_id);

-- 3. Tabela de Números (000 a 600)
CREATE TABLE IF NOT EXISTS raffle_numbers (
    number TEXT PRIMARY KEY, -- '000', '001', ..., '600'
    number_int INT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'available', -- 'available', 'reserved', 'paid'
    order_id UUID REFERENCES raffle_orders(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_numbers_status ON raffle_numbers(status);
CREATE INDEX IF NOT EXISTS idx_numbers_order_id ON raffle_numbers(order_id);

-- 4. Função para popular os números de 0 a 600 automaticamente
DO $$
BEGIN
    FOR i IN 0..600 LOOP
        INSERT INTO raffle_numbers (number, number_int, status)
        VALUES (LPAD(i::text, 3, '0'), i, 'available')
        ON CONFLICT (number) DO NOTHING;
    END LOOP;
END $$;

-- 5. Função Atômica para Reserva Concorrente de Números
-- Garante que se duas pessoas tentarem o mesmo número ao mesmo tempo, apenas uma consegue.
CREATE OR REPLACE FUNCTION reserve_raffle_numbers(
    p_numbers TEXT[],
    p_order_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_available_count INT;
BEGIN
    -- Bloqueia e conta os números solicitados que estão livres
    SELECT COUNT(*)
    INTO v_available_count
    FROM raffle_numbers
    WHERE number = ANY(p_numbers)
      AND status = 'available'
    FOR UPDATE;

    -- Se algum número não estiver disponível, cancela a operação
    IF v_available_count <> array_length(p_numbers, 1) THEN
        RETURN FALSE;
    END IF;

    -- Atualiza os números para reservados vinculando ao pedido
    UPDATE raffle_numbers
    SET status = 'reserved',
        order_id = p_order_id,
        updated_at = timezone('utc'::text, now())
    WHERE number = ANY(p_numbers);

    RETURN TRUE;
END;
$$;

-- 6. Função para Expiração Automática de Reservas Vencidas
CREATE OR REPLACE FUNCTION expire_overdue_orders()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_expired_count INT := 0;
BEGIN
    -- Libera os números de pedidos pendentes vencidos
    UPDATE raffle_numbers
    SET status = 'available',
        order_id = NULL,
        updated_at = timezone('utc'::text, now())
    WHERE status = 'reserved'
      AND order_id IN (
          SELECT id FROM raffle_orders
          WHERE status = 'pending'
            AND expires_at < timezone('utc'::text, now())
      );

    -- Marca os pedidos vencidos como expirados
    WITH updated AS (
        UPDATE raffle_orders
        SET status = 'expired'
        WHERE status = 'pending'
          AND expires_at < timezone('utc'::text, now())
        RETURNING id
    )
    SELECT COUNT(*) INTO v_expired_count FROM updated;

    RETURN v_expired_count;
END;
$$;

-- 7. Habilitar Row Level Security (RLS) e Políticas
ALTER TABLE raffle_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE raffle_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE raffle_numbers ENABLE ROW LEVEL SECURITY;

-- Políticas de Leitura Pública (Para o frontend carregar status dos números e dados da rifa)
CREATE POLICY "Leitura pública de configurações" ON raffle_settings FOR SELECT USING (true);
CREATE POLICY "Leitura pública de números" ON raffle_numbers FOR SELECT USING (true);

-- Política para leitura de pedidos por CPF ou telefone
CREATE POLICY "Leitura de pedidos" ON raffle_orders FOR SELECT USING (true);

-- O backend Node.js utilizará a service_role key do Supabase (ou anon com policies) para modificações com controle total.
CREATE POLICY "Acesso total service_role configurações" ON raffle_settings FOR ALL USING (true);
CREATE POLICY "Acesso total service_role números" ON raffle_numbers FOR ALL USING (true);
CREATE POLICY "Acesso total service_role pedidos" ON raffle_orders FOR ALL USING (true);
