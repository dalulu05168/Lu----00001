
CREATE TABLE IF NOT EXISTS cn_subadmin_notes (
  subadmin_user_id uuid PRIMARY KEY REFERENCES admin_roles(user_id),
  note text NOT NULL CHECK (char_length(note) <= 500),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
