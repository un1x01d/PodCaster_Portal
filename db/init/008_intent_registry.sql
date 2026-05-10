CREATE TABLE IF NOT EXISTS formula_intent_aliases (
  id SERIAL PRIMARY KEY,
  language TEXT NOT NULL,
  phrase TEXT NOT NULL,
  intent_code TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  UNIQUE(language, phrase)
);

CREATE TABLE IF NOT EXISTS formula_composites (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  expression TEXT NOT NULL,
  output_unit TEXT,
  precision_digits INT NOT NULL DEFAULT 2,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO formula_intent_aliases (language, phrase, intent_code, priority) VALUES
('en','how much time do we have left','METRIC_RUNWAY',10),
('en','keep the lights on','METRIC_RUNWAY',10),
('en','what are our operating expenses','FIXED_OPERATING_COSTS',10),
('en','what are our variable expenses','VARIABLE_EXPENSES',10),
('en','are we losing money','METRIC_NET_BURN',10),
('en','what is the bleed','METRIC_NET_BURN',10),
('en','how are our ads performing','AD_PERFORMANCE',10)
ON CONFLICT (language, phrase) DO NOTHING;

INSERT INTO formula_composites (code, label, expression, output_unit, precision_digits, enabled) VALUES
('FIXED_OPERATING_COSTS','Fixed Operating Costs','EXP_OPEX + EXP_PAYROLL + EXP_RENT','currency',2,TRUE),
('VARIABLE_EXPENSES','Volume-Based Variable Costs','EXP_COMMISSIONS + EXP_CLOUD + REV_SHARE','currency',2,TRUE)
ON CONFLICT (code) DO NOTHING;
