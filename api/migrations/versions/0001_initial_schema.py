"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-10-12 15:20:20.486343
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0001'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('organization',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('slug', sa.String(length=100), nullable=False),
    sa.Column('timezone', sa.String(length=64), nullable=False),
    sa.Column('settings', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_organization')),
    sa.UniqueConstraint('slug', name=op.f('uq_organization_slug'))
    )
    op.create_table('user_account',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('full_name', sa.String(length=200), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user_account')),
    sa.UniqueConstraint('email', name=op.f('uq_user_account_email'))
    )
    op.create_table('athlete',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('org_id', sa.Uuid(), nullable=False),
    sa.Column('code', sa.String(length=50), nullable=False),
    sa.Column('first_name', sa.String(length=100), nullable=False),
    sa.Column('last_name', sa.String(length=100), nullable=False),
    sa.Column('preferred_name', sa.String(length=100), nullable=True),
    sa.Column('email', sa.String(length=320), nullable=True),
    sa.Column('date_of_birth', sa.Date(), nullable=True),
    sa.Column('sex', sa.String(length=16), nullable=True),
    sa.Column('position', sa.String(length=100), nullable=True),
    sa.Column('timezone', sa.String(length=64), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('attributes', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=True),
    sa.Column('ow_user_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("status IN ('active', 'inactive', 'archived')", name=op.f('ck_athlete_status')),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_athlete_org_id_organization'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['user_account.id'], name=op.f('fk_athlete_user_id_user_account'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_athlete')),
    sa.UniqueConstraint('org_id', 'code', name=op.f('uq_athlete_org_id_code'))
    )
    op.create_index(op.f('ix_athlete_org_id'), 'athlete', ['org_id'], unique=False)
    op.create_index('ix_athlete_org_status', 'athlete', ['org_id', 'status'], unique=False)
    op.create_index(op.f('ix_athlete_ow_user_id'), 'athlete', ['ow_user_id'], unique=False)
    op.create_index(op.f('ix_athlete_user_id'), 'athlete', ['user_id'], unique=False)
    op.create_table('audit_log',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('org_id', sa.Uuid(), nullable=True),
    sa.Column('user_id', sa.Uuid(), nullable=True),
    sa.Column('action', sa.String(length=64), nullable=False),
    sa.Column('entity_type', sa.String(length=32), nullable=False),
    sa.Column('entity_id', sa.Uuid(), nullable=True),
    sa.Column('at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_audit_log_org_id_organization'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_audit_log'))
    )
    op.create_index('ix_audit_log_entity', 'audit_log', ['entity_type', 'entity_id'], unique=False)
    op.create_index('ix_audit_log_org_at', 'audit_log', ['org_id', 'at'], unique=False)
    op.create_table('form',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('org_id', sa.Uuid(), nullable=False),
    sa.Column('slug', sa.String(length=100), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('sensitivity', sa.String(length=16), nullable=False),
    sa.Column('athlete_can_submit', sa.Boolean(), nullable=False),
    sa.Column('athlete_can_view', sa.Boolean(), nullable=False),
    sa.Column('allow_multiple_per_day', sa.Boolean(), nullable=False),
    sa.Column('draft_schema', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('current_version_id', sa.Uuid(), nullable=True),
    sa.Column('template_key', sa.String(length=64), nullable=True),
    sa.Column('archived', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("kind IN ('questionnaire', 'session', 'test', 'medical', 'profile', 'import')", name=op.f('ck_form_kind')),
    sa.CheckConstraint("sensitivity IN ('general', 'medical', 'research')", name=op.f('ck_form_sensitivity')),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_form_org_id_organization'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_form')),
    sa.UniqueConstraint('org_id', 'slug', name=op.f('uq_form_org_id_slug'))
    )
    op.create_index(op.f('ix_form_org_id'), 'form', ['org_id'], unique=False)
    op.create_table('metric_definition',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('org_id', sa.Uuid(), nullable=False),
    sa.Column('slug', sa.String(length=100), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('unit', sa.String(length=32), nullable=True),
    sa.Column('source', sa.String(length=300), nullable=False),
    sa.Column('daily_agg', sa.String(length=8), nullable=False),
    sa.Column('fill_zero', sa.Boolean(), nullable=False),
    sa.Column('transform', sa.String(length=16), nullable=False),
    sa.Column('params', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('thresholds', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('decimals', sa.Integer(), nullable=False),
    sa.Column('athlete_visible', sa.Boolean(), nullable=False),
    sa.Column('builtin', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_metric_definition_org_id_organization'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_metric_definition')),
    sa.UniqueConstraint('org_id', 'slug', name=op.f('uq_metric_definition_org_id_slug'))
    )
    op.create_index(op.f('ix_metric_definition_org_id'), 'metric_definition', ['org_id'], unique=False)
    op.create_table('org_group',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('org_id', sa.Uuid(), nullable=False),
    sa.Column('parent_id', sa.Uuid(), nullable=True),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('archived', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("kind IN ('team', 'squad', 'unit', 'section', 'study', 'cohort', 'other')", name=op.f('ck_org_group_kind')),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_org_group_org_id_organization'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['parent_id'], ['org_group.id'], name=op.f('fk_org_group_parent_id_org_group'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_org_group'))
    )
    op.create_index(op.f('ix_org_group_org_id'), 'org_group', ['org_id'], unique=False)
    op.create_index(op.f('ix_org_group_parent_id'), 'org_group', ['parent_id'], unique=False)
    op.create_table('org_membership',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('org_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("role IN ('owner', 'admin', 'staff', 'athlete')", name=op.f('ck_org_membership_role')),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_org_membership_org_id_organization'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['user_account.id'], name=op.f('fk_org_membership_user_id_user_account'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_org_membership')),
    sa.UniqueConstraint('org_id', 'user_id', name=op.f('uq_org_membership_org_id_user_id'))
    )
    op.create_index(op.f('ix_org_membership_org_id'), 'org_membership', ['org_id'], unique=False)
    op.create_index(op.f('ix_org_membership_user_id'), 'org_membership', ['user_id'], unique=False)
    op.create_table('push_token',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('token', sa.String(length=255), nullable=False),
    sa.Column('platform', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("platform IN ('ios', 'android')", name=op.f('ck_push_token_platform')),
    sa.ForeignKeyConstraint(['user_id'], ['user_account.id'], name=op.f('fk_push_token_user_id_user_account'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_push_token')),
    sa.UniqueConstraint('token', name=op.f('uq_push_token_token'))
    )
    op.create_index(op.f('ix_push_token_user_id'), 'push_token', ['user_id'], unique=False)
    op.create_table('refresh_token',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('family_id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('replaced_by_id', sa.Uuid(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user_account.id'], name=op.f('fk_refresh_token_user_id_user_account'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_refresh_token')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_refresh_token_token_hash'))
    )
    op.create_index(op.f('ix_refresh_token_family_id'), 'refresh_token', ['family_id'], unique=False)
    op.create_index(op.f('ix_refresh_token_user_id'), 'refresh_token', ['user_id'], unique=False)
    op.create_table('athlete_group',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('org_id', sa.Uuid(), nullable=False),
    sa.Column('athlete_id', sa.Uuid(), nullable=False),
    sa.Column('group_id', sa.Uuid(), nullable=False),
    sa.Column('joined_on', sa.Date(), nullable=False),
    sa.Column('left_on', sa.Date(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['athlete_id'], ['athlete.id'], name=op.f('fk_athlete_group_athlete_id_athlete'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['group_id'], ['org_group.id'], name=op.f('fk_athlete_group_group_id_org_group'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_athlete_group_org_id_organization'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_athlete_group'))
    )
    op.create_index(op.f('ix_athlete_group_athlete_id'), 'athlete_group', ['athlete_id'], unique=False)
    op.create_index('ix_athlete_group_group_athlete', 'athlete_group', ['group_id', 'athlete_id'], unique=False)
    op.create_index(op.f('ix_athlete_group_org_id'), 'athlete_group', ['org_id'], unique=False)
    op.create_table('form_schedule',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('org_id', sa.Uuid(), nullable=False),
    sa.Column('form_id', sa.Uuid(), nullable=False),
    sa.Column('group_id', sa.Uuid(), nullable=False),
    sa.Column('recurrence', sa.String(length=16), nullable=False),
    sa.Column('days_of_week', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('due_time', sa.String(length=5), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=False),
    sa.Column('end_date', sa.Date(), nullable=True),
    sa.Column('remind', sa.Boolean(), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("recurrence IN ('daily', 'weekly', 'once')", name=op.f('ck_form_schedule_recurrence')),
    sa.ForeignKeyConstraint(['form_id'], ['form.id'], name=op.f('fk_form_schedule_form_id_form'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['group_id'], ['org_group.id'], name=op.f('fk_form_schedule_group_id_org_group'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_form_schedule_org_id_organization'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_form_schedule'))
    )
    op.create_index(op.f('ix_form_schedule_form_id'), 'form_schedule', ['form_id'], unique=False)
    op.create_index(op.f('ix_form_schedule_group_id'), 'form_schedule', ['group_id'], unique=False)
    op.create_index(op.f('ix_form_schedule_org_id'), 'form_schedule', ['org_id'], unique=False)
    op.create_table('form_version',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('form_id', sa.Uuid(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('schema', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('published_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('published_by', sa.Uuid(), nullable=True),
    sa.ForeignKeyConstraint(['form_id'], ['form.id'], name=op.f('fk_form_version_form_id_form'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['published_by'], ['user_account.id'], name=op.f('fk_form_version_published_by_user_account'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_form_version')),
    sa.UniqueConstraint('form_id', 'version', name=op.f('uq_form_version_form_id_version'))
    )
    op.create_index(op.f('ix_form_version_form_id'), 'form_version', ['form_id'], unique=False)
    # form.current_version_id <-> form_version.form_id is circular: add this FK once both tables exist
    op.create_foreign_key(op.f('fk_form_current_version_id_form_version'), 'form', 'form_version', ['current_version_id'], ['id'], ondelete='SET NULL', use_alter=True)
    op.create_table('import_batch',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('org_id', sa.Uuid(), nullable=False),
    sa.Column('form_id', sa.Uuid(), nullable=False),
    sa.Column('upload_id', sa.Uuid(), nullable=True),
    sa.Column('filename', sa.String(length=255), nullable=False),
    sa.Column('created_by', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('row_count', sa.Integer(), nullable=False),
    sa.Column('created_count', sa.Integer(), nullable=False),
    sa.Column('skipped_count', sa.Integer(), nullable=False),
    sa.Column('errors', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('dry_run', sa.Boolean(), nullable=False),
    sa.Column('config', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['created_by'], ['user_account.id'], name=op.f('fk_import_batch_created_by_user_account'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['form_id'], ['form.id'], name=op.f('fk_import_batch_form_id_form'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_import_batch_org_id_organization'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_import_batch'))
    )
    op.create_index(op.f('ix_import_batch_form_id'), 'import_batch', ['form_id'], unique=False)
    op.create_index(op.f('ix_import_batch_org_id'), 'import_batch', ['org_id'], unique=False)
    op.create_table('import_upload',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('org_id', sa.Uuid(), nullable=False),
    sa.Column('form_id', sa.Uuid(), nullable=False),
    sa.Column('filename', sa.String(length=255), nullable=False),
    sa.Column('stored_path', sa.String(length=1024), nullable=False),
    sa.Column('created_by', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['user_account.id'], name=op.f('fk_import_upload_created_by_user_account'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['form_id'], ['form.id'], name=op.f('fk_import_upload_form_id_form'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_import_upload_org_id_organization'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_import_upload'))
    )
    op.create_index(op.f('ix_import_upload_org_id'), 'import_upload', ['org_id'], unique=False)
    op.create_table('invitation',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('org_id', sa.Uuid(), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('athlete_id', sa.Uuid(), nullable=True),
    sa.Column('token_salt', sa.String(length=64), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_by', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("role IN ('owner', 'admin', 'staff', 'athlete')", name=op.f('ck_invitation_role')),
    sa.ForeignKeyConstraint(['athlete_id'], ['athlete.id'], name=op.f('fk_invitation_athlete_id_athlete'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['created_by'], ['user_account.id'], name=op.f('fk_invitation_created_by_user_account'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_invitation_org_id_organization'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_invitation')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_invitation_token_hash'))
    )
    op.create_index(op.f('ix_invitation_org_id'), 'invitation', ['org_id'], unique=False)
    op.create_table('reminder_sent',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('org_id', sa.Uuid(), nullable=False),
    sa.Column('athlete_id', sa.Uuid(), nullable=False),
    sa.Column('form_id', sa.Uuid(), nullable=False),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['athlete_id'], ['athlete.id'], name=op.f('fk_reminder_sent_athlete_id_athlete'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['form_id'], ['form.id'], name=op.f('fk_reminder_sent_form_id_form'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_reminder_sent_org_id_organization'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_reminder_sent')),
    sa.UniqueConstraint('athlete_id', 'form_id', 'local_date', name=op.f('uq_reminder_sent_athlete_id_form_id_local_date'))
    )
    op.create_index(op.f('ix_reminder_sent_org_id'), 'reminder_sent', ['org_id'], unique=False)
    op.create_table('staff_assignment',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('org_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('group_id', sa.Uuid(), nullable=False),
    sa.Column('access_role', sa.String(length=16), nullable=False),
    sa.Column('can_view_identifiable', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("access_role IN ('viewer', 'coach', 'practitioner', 'medical', 'researcher')", name=op.f('ck_staff_assignment_access_role')),
    sa.ForeignKeyConstraint(['group_id'], ['org_group.id'], name=op.f('fk_staff_assignment_group_id_org_group'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_staff_assignment_org_id_organization'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['user_account.id'], name=op.f('fk_staff_assignment_user_id_user_account'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_staff_assignment')),
    sa.UniqueConstraint('user_id', 'group_id', name=op.f('uq_staff_assignment_user_id_group_id'))
    )
    op.create_index(op.f('ix_staff_assignment_group_id'), 'staff_assignment', ['group_id'], unique=False)
    op.create_index(op.f('ix_staff_assignment_org_id'), 'staff_assignment', ['org_id'], unique=False)
    op.create_index(op.f('ix_staff_assignment_user_id'), 'staff_assignment', ['user_id'], unique=False)
    op.create_table('wearable_daily',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('org_id', sa.Uuid(), nullable=False),
    sa.Column('athlete_id', sa.Uuid(), nullable=False),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('metric', sa.String(length=40), nullable=False),
    sa.Column('value', sa.Float(), nullable=False),
    sa.Column('unit', sa.String(length=16), nullable=False),
    sa.Column('provider', sa.String(length=64), nullable=False),
    sa.Column('device', sa.String(length=200), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['athlete_id'], ['athlete.id'], name=op.f('fk_wearable_daily_athlete_id_athlete'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_wearable_daily_org_id_organization'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_wearable_daily')),
    sa.UniqueConstraint('athlete_id', 'local_date', 'metric', 'provider', name=op.f('uq_wearable_daily_athlete_id_local_date_metric_provider'))
    )
    op.create_index('ix_wearable_daily_athlete_metric_date', 'wearable_daily', ['athlete_id', 'metric', 'local_date'], unique=False)
    op.create_index(op.f('ix_wearable_daily_org_id'), 'wearable_daily', ['org_id'], unique=False)
    op.create_table('submission',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('org_id', sa.Uuid(), nullable=False),
    sa.Column('form_id', sa.Uuid(), nullable=False),
    sa.Column('form_version_id', sa.Uuid(), nullable=False),
    sa.Column('athlete_id', sa.Uuid(), nullable=False),
    sa.Column('submitted_by', sa.Uuid(), nullable=True),
    sa.Column('observed_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('values', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('computed', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.Column('import_batch_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("source IN ('mobile', 'web', 'import', 'api')", name=op.f('ck_submission_source')),
    sa.ForeignKeyConstraint(['athlete_id'], ['athlete.id'], name=op.f('fk_submission_athlete_id_athlete'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['form_id'], ['form.id'], name=op.f('fk_submission_form_id_form'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['form_version_id'], ['form_version.id'], name=op.f('fk_submission_form_version_id_form_version'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['import_batch_id'], ['import_batch.id'], name=op.f('fk_submission_import_batch_id_import_batch'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_submission_org_id_organization'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['submitted_by'], ['user_account.id'], name=op.f('fk_submission_submitted_by_user_account'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_submission'))
    )
    op.create_index('ix_submission_athlete_form_date', 'submission', ['athlete_id', 'form_id', 'local_date'], unique=False)
    op.create_index(op.f('ix_submission_import_batch_id'), 'submission', ['import_batch_id'], unique=False)
    op.create_index('ix_submission_org_form_date', 'submission', ['org_id', 'form_id', 'local_date'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_submission_org_form_date', table_name='submission')
    op.drop_index(op.f('ix_submission_import_batch_id'), table_name='submission')
    op.drop_index('ix_submission_athlete_form_date', table_name='submission')
    op.drop_table('submission')
    op.drop_index(op.f('ix_wearable_daily_org_id'), table_name='wearable_daily')
    op.drop_index('ix_wearable_daily_athlete_metric_date', table_name='wearable_daily')
    op.drop_table('wearable_daily')
    op.drop_index(op.f('ix_staff_assignment_user_id'), table_name='staff_assignment')
    op.drop_index(op.f('ix_staff_assignment_org_id'), table_name='staff_assignment')
    op.drop_index(op.f('ix_staff_assignment_group_id'), table_name='staff_assignment')
    op.drop_table('staff_assignment')
    op.drop_index(op.f('ix_reminder_sent_org_id'), table_name='reminder_sent')
    op.drop_table('reminder_sent')
    op.drop_index(op.f('ix_invitation_org_id'), table_name='invitation')
    op.drop_table('invitation')
    op.drop_index(op.f('ix_import_upload_org_id'), table_name='import_upload')
    op.drop_table('import_upload')
    op.drop_index(op.f('ix_import_batch_org_id'), table_name='import_batch')
    op.drop_index(op.f('ix_import_batch_form_id'), table_name='import_batch')
    op.drop_table('import_batch')
    op.drop_index(op.f('ix_form_version_form_id'), table_name='form_version')
    op.drop_constraint(op.f('fk_form_current_version_id_form_version'), 'form', type_='foreignkey')
    op.drop_table('form_version')
    op.drop_index(op.f('ix_form_schedule_org_id'), table_name='form_schedule')
    op.drop_index(op.f('ix_form_schedule_group_id'), table_name='form_schedule')
    op.drop_index(op.f('ix_form_schedule_form_id'), table_name='form_schedule')
    op.drop_table('form_schedule')
    op.drop_index(op.f('ix_athlete_group_org_id'), table_name='athlete_group')
    op.drop_index('ix_athlete_group_group_athlete', table_name='athlete_group')
    op.drop_index(op.f('ix_athlete_group_athlete_id'), table_name='athlete_group')
    op.drop_table('athlete_group')
    op.drop_index(op.f('ix_refresh_token_user_id'), table_name='refresh_token')
    op.drop_index(op.f('ix_refresh_token_family_id'), table_name='refresh_token')
    op.drop_table('refresh_token')
    op.drop_index(op.f('ix_push_token_user_id'), table_name='push_token')
    op.drop_table('push_token')
    op.drop_index(op.f('ix_org_membership_user_id'), table_name='org_membership')
    op.drop_index(op.f('ix_org_membership_org_id'), table_name='org_membership')
    op.drop_table('org_membership')
    op.drop_index(op.f('ix_org_group_parent_id'), table_name='org_group')
    op.drop_index(op.f('ix_org_group_org_id'), table_name='org_group')
    op.drop_table('org_group')
    op.drop_index(op.f('ix_metric_definition_org_id'), table_name='metric_definition')
    op.drop_table('metric_definition')
    op.drop_index(op.f('ix_form_org_id'), table_name='form')
    op.drop_table('form')
    op.drop_index('ix_audit_log_org_at', table_name='audit_log')
    op.drop_index('ix_audit_log_entity', table_name='audit_log')
    op.drop_table('audit_log')
    op.drop_index(op.f('ix_athlete_user_id'), table_name='athlete')
    op.drop_index(op.f('ix_athlete_ow_user_id'), table_name='athlete')
    op.drop_index('ix_athlete_org_status', table_name='athlete')
    op.drop_index(op.f('ix_athlete_org_id'), table_name='athlete')
    op.drop_table('athlete')
    op.drop_table('user_account')
    op.drop_table('organization')
