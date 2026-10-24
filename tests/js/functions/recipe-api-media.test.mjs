import { createRequire } from 'node:module';
import * as model from '../../../src/js/shared/recipe-model.js';

const require = createRequire(import.meta.url);
const {
  parseMultipart,
  sniffType,
  typesAgree,
  planUploads,
} = require('../../../functions/api/media.js');

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9,
]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(8)]);
const MOV = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  '), Buffer.alloc(8)]);
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]);
const TEXT = Buffer.from('<html>not an image</html>');

const file = (data, mimeType, filename = 'f') => ({ data, mimeType, filename });

describe('recipe API media (functions/api/media.js)', () => {
  describe('sniffType', () => {
    it.each([
      [JPEG, 'image/jpeg'],
      [PNG, 'image/png'],
      [GIF, 'image/gif'],
      [WEBP, 'image/webp'],
      [MP4, 'video/mp4'],
      [MOV, 'video/quicktime'],
      [WEBM, 'video/webm'],
      [TEXT, null],
      [Buffer.alloc(0), null],
    ])('recognizes %#', (data, type) => {
      expect(sniffType(data)).toBe(type);
    });

    it('lets MP4 and QuickTime stand in for each other, nothing else', () => {
      expect(typesAgree('video/quicktime', 'video/mp4')).toBe(true);
      expect(typesAgree('image/jpeg', 'image/png')).toBe(false);
    });
  });

  describe('planUploads', () => {
    const files = (entries) => new Map(Object.entries(entries));

    it('plans photos and step media in order, the first photo primary by default', () => {
      const plan = planUploads(
        {
          images: [{ part: 'a' }, { part: 'b' }],
          mediaInstructions: [{ part: 'v', caption: ' לערבב ' }, { part: 'g' }],
        },
        files({
          a: file(JPEG, 'image/jpeg'),
          b: file(PNG, 'image/png'),
          v: file(MP4, 'video/mp4'),
          g: file(GIF, 'image/gif'),
        }),
        model,
      );
      expect(plan.images.map((i) => i.isPrimary)).toEqual([true, false]);
      expect(plan.media.map((m) => [m.type, m.caption])).toEqual([
        ['video', 'לערבב'],
        ['image', ''],
      ]);
    });

    it('keeps a chosen primary photo', () => {
      const plan = planUploads(
        { images: [{ part: 'a' }, { part: 'b', isPrimary: true }] },
        files({ a: file(JPEG, 'image/jpeg'), b: file(JPEG, 'image/jpeg') }),
        model,
      );
      expect(plan.images.map((i) => i.isPrimary)).toEqual([false, true]);
    });

    const problems = (request, parts) => {
      try {
        planUploads(request, files(parts), model);
      } catch (error) {
        return [error.status, error.code, error.details.map((d) => d.field)];
      }
      throw new Error('expected planUploads to refuse');
    };

    it('applies the photo rules of the image picker', () => {
      expect(problems({ images: [{ part: 'g' }] }, { g: file(GIF, 'image/gif') })).toEqual([
        400,
        'invalid-files',
        ['images[0]'],
      ]);
      const big = Buffer.concat([JPEG, Buffer.alloc(model.PHOTO_MAX_BYTES)]);
      expect(problems({ images: [{ part: 'a' }] }, { a: file(big, 'image/jpeg') })[2]).toEqual([
        'images[0]',
      ]);
      const six = Object.fromEntries(
        Array.from({ length: 6 }, (_, i) => [`p${i}`, file(JPEG, 'image/jpeg')]),
      );
      expect(problems({ images: Object.keys(six).map((part) => ({ part })) }, six)[2]).toContain(
        'images',
      );
      expect(
        problems(
          {
            images: [
              { part: 'a', isPrimary: true },
              { part: 'b', isPrimary: true },
            ],
          },
          { a: file(JPEG, 'image/jpeg'), b: file(JPEG, 'image/jpeg') },
        )[2],
      ).toEqual(['images']);
    });

    it('refuses a file whose content does not match its type', () => {
      expect(problems({ images: [{ part: 'a' }] }, { a: file(TEXT, 'image/jpeg') })[2]).toEqual([
        'images[0]',
      ]);
      expect(
        problems({ mediaInstructions: [{ part: 'v' }] }, { v: file(JPEG, 'video/mp4') })[2],
      ).toEqual(['mediaInstructions[0]']);
    });

    it('matches entries and file parts one to one', () => {
      expect(problems({ images: [{ part: 'missing' }] }, {})[2]).toEqual(['images[0].part']);
      expect(
        problems(
          { images: [{ part: 'a' }], mediaInstructions: [{ part: 'a' }] },
          { a: file(JPEG, 'image/jpeg') },
        )[2],
      ).toEqual(['mediaInstructions[0].part']);
      expect(problems({}, { stray: file(JPEG, 'image/jpeg') })[2]).toEqual(['stray']);
    });

    it('rejects unknown entry fields and bad values', () => {
      expect(
        problems(
          { images: [{ part: 'a', isPrimary: 'yes', alt: 'x' }] },
          { a: file(JPEG, 'image/jpeg') },
        )[2],
      ).toEqual(['images[0].alt', 'images[0].isPrimary']);
      expect(
        problems(
          { mediaInstructions: [{ part: 'v', caption: 5 }] },
          { v: file(MP4, 'video/mp4') },
        )[2],
      ).toEqual(['mediaInstructions[0].caption']);
      expect(problems({ images: 'a' }, {})[2]).toEqual(['images']);
    });
  });

  describe('parseMultipart', () => {
    const boundary = 'XyZ';
    const part = (headers, body) =>
      Buffer.concat([
        Buffer.from(`--${boundary}\r\n${headers}\r\n\r\n`),
        body,
        Buffer.from('\r\n'),
      ]);
    const req = (parts) => ({
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      rawBody: Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]),
    });

    it('returns the fields and the file parts', async () => {
      const { fields, files } = await parseMultipart(
        req([
          part('Content-Disposition: form-data; name="request"', Buffer.from('{"a":1}')),
          part(
            'Content-Disposition: form-data; name="p"; filename="x.jpg"\r\nContent-Type: image/jpeg',
            JPEG,
          ),
        ]),
      );
      expect(fields).toEqual({ request: '{"a":1}' });
      expect(files.get('p')).toEqual({ filename: 'x.jpg', mimeType: 'image/jpeg', data: JPEG });
    });

    it('refuses two file parts with one name', async () => {
      const filePart = part(
        'Content-Disposition: form-data; name="p"; filename="x.jpg"\r\nContent-Type: image/jpeg',
        JPEG,
      );
      await expect(parseMultipart(req([filePart, filePart]))).rejects.toMatchObject({
        status: 400,
      });
    });

    it('refuses too many fields instead of silently dropping the request', async () => {
      const junk = Array.from({ length: 6 }, (_, i) =>
        part(`Content-Disposition: form-data; name="junk${i}"`, Buffer.from('x')),
      );
      await expect(parseMultipart(req(junk))).rejects.toMatchObject({ status: 400 });
    });

    it('refuses an empty body', () => {
      expect(() => parseMultipart({ headers: {}, rawBody: Buffer.alloc(0) })).toThrow();
    });
  });
});
