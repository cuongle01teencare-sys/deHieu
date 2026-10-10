export const toSlug = (input: string): string =>
  input
    .normalize('NFD') // tách "ế" → "e" + dấu mũ + dấu sắc
    .replace(/[\u0300-\u036f]/g, '') // xoá phần dấu, giữ lại "e"
    .replace(/đ/g, 'd') // "đ" không tách được bằng NFD
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // cụm ký tự còn lại không phải chữ/số → "-"
    .replace(/^-+|-+$/g, ''); // bỏ "-" thừa ở đầu và cuối
