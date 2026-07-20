import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const demoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(demoRoot, '..');
const licenseFilePattern = /^(?:licen[cs]e|copying|notice)(?:\.|$)/iu;

function packageName(packagePath) {
  return packagePath.split('node_modules/').at(-1);
}

async function installedPackageRecord(packagePath, metadata) {
  const directory = resolve(demoRoot, packagePath);
  const filenames = await readdir(directory).catch(() => []);
  const licenseFiles = filenames
    .filter((filename) => licenseFilePattern.test(filename))
    .sort((left, right) => left.localeCompare(right));
  if (licenseFiles.length === 0) return null;

  const manifest = JSON.parse(
    await readFile(resolve(directory, 'package.json'), 'utf8'),
  );
  const sections = await Promise.all(
    licenseFiles.map(async (filename) => {
      const content = await readFile(resolve(directory, filename), 'utf8');
      return '--- ' + filename + ' ---\n\n' + content.trim();
    }),
  );
  const repository = typeof manifest.repository === 'string'
    ? manifest.repository
    : manifest.repository?.url;

  return {
    id: packageName(packagePath) + '@' + metadata.version,
    text: [
      'PACKAGE: ' + packageName(packagePath),
      'VERSION: ' + metadata.version,
      'DECLARED LICENSE: ' + (metadata.license ?? manifest.license ?? 'not declared'),
      ...repository ? ['SOURCE: ' + repository] : [],
      '',
      ...sections,
    ].join('\n'),
  };
}

export async function writeThirdPartyLicenseBundle(outputPath) {
  const lock = JSON.parse(
    await readFile(resolve(demoRoot, 'package-lock.json'), 'utf8'),
  );
  const records = (
    await Promise.all(
      Object.entries(lock.packages)
        .filter(([packagePath, metadata]) =>
          packagePath.includes('node_modules/') && metadata.dev !== true)
        .map(([packagePath, metadata]) =>
          installedPackageRecord(packagePath, metadata)),
    )
  ).filter(Boolean);

  const uniqueRecords = [...new Map(
    records.map((record) => [record.id, record]),
  ).values()].sort((left, right) => left.id.localeCompare(right.id));

  const curatedDirectory = resolve(repositoryRoot, 'LICENSES');
  const curatedFiles = (await readdir(curatedDirectory).catch(() => []))
    .filter((filename) =>
      licenseFilePattern.test(filename) || filename.endsWith('.txt'))
    .sort((left, right) => left.localeCompare(right));
  const curatedSections = await Promise.all(
    curatedFiles.map(async (filename) => [
      'CURATED NOTICE: ' + filename,
      '',
      (await readFile(resolve(curatedDirectory, filename), 'utf8')).trim(),
    ].join('\n')),
  );

  const divider = '\n\n' + '='.repeat(78) + '\n\n';
  const header = [
    'THIRD-PARTY SOFTWARE LICENSES',
    '',
    'Generated from installed production dependencies in demo/package-lock.json.',
    'Model, media, service, and asset terms are documented separately in',
    'THIRD_PARTY_NOTICES.md.',
  ].join('\n');
  const output = header + divider + [
    ...uniqueRecords.map((record) => record.text),
    ...curatedSections,
  ].join(divider) + '\n';

  await writeFile(outputPath, output, 'utf8');
}
