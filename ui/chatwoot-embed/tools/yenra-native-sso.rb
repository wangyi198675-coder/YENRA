# frozen_string_literal: true
# Per-install native Chatwoot Platform API setup. Runs only at first install
# (or when the local Platform credential has been explicitly lost).
# Creates no second auth/session store: Chatwoot Users, PlatformApp and Redis SSO
# are official Chatwoot 4.19.1 database/native capabilities.
require 'json'
require 'securerandom'
require 'fileutils'

account_id = Integer(ENV.fetch('YENRA_CHATWOOT_ACCOUNT_ID', '1'), 10)
raise 'YENRA_ACCOUNT_SCOPE_INVALID' unless account_id.positive?
credential_path = '/app/storage/yenra-desktop-platform-sso.json'

account = Account.find_by(id: account_id)
if account.nil?
  raise 'YENRA_EXISTING_DATA_CANNOT_BE_CLAIMED' unless Account.count.zero? && User.count.zero?
  raise 'YENRA_FIRST_ACCOUNT_ID_REQUIRED' unless account_id == 1
  # One native Chatwoot user/account and four native API Inboxes are created
  # ONLY for a truly empty per-install PostgreSQL instance; never import
  # another person's credentials, messages or contacts.
  Account.transaction do
    account = Account.create!(name: 'YENRA Private Inbox', locale: 'zh_CN')
    user = User.new(name: 'YENRA Local Owner',
                    email: "yenra-owner-#{SecureRandom.hex(12)}@local.invalid",
                    password: SecureRandom.base64(54))
    user.skip_confirmation!
    user.save!
    AccountUser.create!(account: account, user: user, role: :administrator)
    ['FB Personal', 'WhatsApp 1', 'WhatsApp 2', 'FB Page'].each do |label|
      inbox = Inbox.create!(account: account, name: "YENRA #{label}",
                            channel: Channel::Api.create!(account: account))
      inbox.inbox_members.create!(user: user)
    end
  end
end

owners = AccountUser.where(account_id: account.id, role: AccountUser.roles.fetch('administrator'))
                    .includes(:user).limit(2).to_a
raise 'YENRA_OWNER_NOT_UNIQUE' unless owners.length == 1
owner = owners.first.user
raise 'YENRA_OWNER_NOT_ACTIVE' unless owner && owner.active_for_authentication?
raise 'YENRA_OWNER_NOT_CONFIRMED' unless owner.confirmed?

app = PlatformApp.where(name: 'YENRA Desktop Local SSO').first_or_create!
raise 'YENRA_PLATFORM_APP_NOT_UNIQUE' unless PlatformApp.where(name: app.name).count == 1
app.platform_app_permissibles.find_or_create_by!(permissible: owner)
access = app.access_token || app.create_access_token
raise 'YENRA_PLATFORM_APP_TOKEN_MISSING' unless access&.token.present?

FileUtils.mkdir_p(File.dirname(credential_path))
File.open(credential_path, File::WRONLY | File::CREAT | File::TRUNC, 0o600) do |file|
  file.write(JSON.generate({ account_id: account.id, user_id: owner.id, token: access.token }))
end
File.chmod(0o600, credential_path)
# The SAME native Chatwoot User token is available to the existing Bridge for
# its standard inbox API, never a second Sender or separate user database.
bridge_token = owner.access_token || owner.create_access_token
raise 'YENRA_BRIDGE_NATIVE_TOKEN_MISSING' unless bridge_token&.token.present?
bridge_path = '/app/storage/yenra-desktop-bridge.json'
File.open(bridge_path, File::WRONLY | File::CREAT | File::TRUNC, 0o600) do |file|
  file.write(JSON.generate({account_id: account.id, api_access_token: bridge_token.token}))
end
File.chmod(0o600, bridge_path)
STDOUT.puts('YENRA_PLATFORM_SSO_BOOTSTRAP_READY')
