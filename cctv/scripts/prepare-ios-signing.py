"""Prepare Apple signing in an ephemeral macOS CI runner; never commit credentials."""
import base64
import datetime
import os
import pathlib
import plistlib
import shutil
import subprocess

scratch = pathlib.Path(os.environ['RUNNER_TEMP'])
team = os.environ['IOS_TEAM_ID']
bundle = 'id.anekajaya.aiCctvChecker'
for variable, filename in [('IOS_CERTIFICATE_P12_BASE64', 'cctv-signing.p12'),
                           ('IOS_PROVISION_PROFILE_BASE64', 'cctv-profile.mobileprovision')]:
    path = scratch / filename
    path.write_bytes(base64.b64decode(''.join(os.environ[variable].split()), validate=True))
    path.chmod(0o600)
profile = plistlib.loads(subprocess.check_output(['security', 'cms', '-D', '-i', str(scratch / 'cctv-profile.mobileprovision')]))
entitlements = profile['Entitlements']
if profile['TeamIdentifier'] != [team] or not entitlements['application-identifier'].endswith('.' + bundle):
    raise SystemExit('Provisioning profile tidak cocok dengan Team atau bundle aplikasi.')
if entitlements.get('aps-environment') != 'production' or entitlements.get('get-task-allow', False) or profile.get('ProvisionedDevices') or profile.get('ProvisionsAllDevices'):
    raise SystemExit('Gunakan profile App Store dengan Push Notifications, bukan profile development/ad hoc.')
if profile['ExpirationDate'] < datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None):
    raise SystemExit('Provisioning profile sudah kedaluwarsa.')
uuid = profile['UUID']
if not all(c in 'abcdefABCDEF0123456789-' for c in uuid):
    raise SystemExit('UUID provisioning profile tidak valid.')
profiles = pathlib.Path.home() / 'Library/MobileDevice/Provisioning Profiles'
profiles.mkdir(parents=True, exist_ok=True)
shutil.copyfile(scratch / 'cctv-profile.mobileprovision', profiles / (uuid + '.mobileprovision'))
new_profiles = pathlib.Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles'
new_profiles.mkdir(parents=True, exist_ok=True)
shutil.copyfile(scratch / 'cctv-profile.mobileprovision', new_profiles / (uuid + '.mobileprovision'))
project = pathlib.Path('mobile/ios/Runner.xcodeproj/project.pbxproj')
settings = f'DEVELOPMENT_TEAM = {team};\nCODE_SIGN_STYLE = Manual;\nPROVISIONING_PROFILE_SPECIFIER = "{uuid}";\nCODE_SIGN_IDENTITY = "Apple Distribution";\n"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Distribution";'
project.write_text(project.read_text().replace('CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;', 'CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;\n' + settings))
with (scratch / 'ExportOptions.plist').open('wb') as handle:
    plistlib.dump({'method': 'app-store-connect', 'teamID': team, 'signingStyle': 'manual',
                  'signingCertificate': 'Apple Distribution', 'provisioningProfiles': {bundle: uuid},
                  'manageAppVersionAndBuildNumber': False}, handle)
print('Profile Apple sesuai. Identitas penandatanganan akan diimpor pada keychain sementara.')
