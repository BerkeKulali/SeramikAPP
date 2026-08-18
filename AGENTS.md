<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Çalışma tercihleri

- **Bir iş bittiğinde commit'i yap ve push komutunu mesajın sonunda ver.** Kullanıcı ayrıca istemek zorunda kalmasın. Commit mesajları Türkçe yazılır.
- Push'u kullanıcı kendi terminalinde atar. Verilecek komut:

  ```bash
  cd "/Users/serdemtorun/Desktop/KULALILAR/APPs/SERAMİK BANNER/banner-studio"
  git push origin main
  rm -f .git/index.lock.* .git/HEAD.lock.*
  find .git/objects -name 'tmp_obj_*' -delete
  ```

  Son iki satır gerekli: uzak oturumdan dosya silinemediği için git'in bıraktığı
  geçici kilit ve nesne dosyaları birikiyor.

## Bilinmesi gerekenler

- `public/urunler/<marka>/<ebat>/<dosya>` altına görsel eklendikten sonra
  `npm run sync:products` çalıştırılmalı; yoksa ürün uygulamada görünmez.
  Klasör adında ayırıcı olarak `x`, `-` veya `*` kullanılabilir, script küçük
  harfe ve `x`'e normalleştirir.
- `npm run build` kullanıcının makinesinde çalışır; uzak Linux ortamında
  SWC binary'si eksik olduğu için orada çalışmaz.
