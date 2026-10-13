# Thuật ngữ và cách hệ thống chạy

Hệ thống nhận giá từ SptPub và Polymarket, gom các báo giá tương ứng, rồi tìm cơ hội arbitrage. Trang web giúp quan sát và điều khiển quá trình này. Các tên đội, ID và thời gian trong ví dụ là dữ liệu minh họa.

## Bắt đầu từ một ví dụ

Alliance gặp Sinners. Hai nền tảng đưa ra giá khác nhau cho cùng câu hỏi: **đội nào thắng trận?**

| Nguồn      | Alliance thắng | Sinners thắng |
| ---------- | -------------- | ------------- |
| SptPub     | 1.80           | 2.20          |
| Polymarket | 2.10           | 1.90          |

Chỉ cần nhớ bốn điều:

1. **Một ô số là một odds.** Ví dụ `1.80`: cược 100 và thắng thì nhận tổng 180, gồm 100 vốn và 80 lãi, trước phí.
2. **Một hàng là một báo giá của một nguồn.** Code gọi hàng đó là `OddsLine`, giao diện hiện gọi là **dòng kèo**. Bộ odds của SptPub là `[1.80, 2.20]`.
3. **Cả bảng nằm trong một room.** Room này chỉ dành cho trận Alliance gặp Sinners và loại cược thắng trận.
4. **Hệ thống thử ghép hai ô thuộc hai nguồn khác nhau.** Ví dụ Alliance thắng ở Polymarket (`2.10`) và Sinners thắng ở SptPub (`2.20`). Nếu đạt điều kiện, hệ thống phát một **tín hiệu cơ hội arbitrage**. Giao diện hiện gọi tín hiệu này là **kèo**.

Hai báo giá gốc vẫn nằm trong room sau khi phát tín hiệu. Một dòng kèo không bị lấy ra khỏi room hoặc biến thành tín hiệu.

## Những tên cần nhớ

### Về trận và giá

| Tên trên web hoặc trong code | Hiểu đơn giản                                                        | Ví dụ                                   |
| ---------------------------- | -------------------------------------------------------------------- | --------------------------------------- |
| Tenant                       | Nguồn cung cấp dữ liệu; không phải người dùng đăng nhập web          | `sptpub`, `polymarket`                  |
| Sport                        | Môn thi đấu                                                          | `cs2`, `lol`                            |
| Match / Trận đấu             | Một cặp đội trong một môn; có thể có nhiều loại cược                 | Alliance gặp Sinners                    |
| Market                       | Một loại cược cụ thể, gồm cả mức chấp, mốc tổng hoặc số map nếu có   | Thắng trận, thắng map 1, tổng map 2.5   |
| Side / Phía                  | Một trong hai kết quả của market                                     | `0` và `1`                              |
| Pick / Cửa chọn              | Tên dễ đọc của kết quả được chọn                                     | `alliance`, `over 2.5`                  |
| Odds                         | Hệ số trả thưởng cho một kết quả                                     | `2.20`                                  |
| Bộ odds                      | Hai odds theo thứ tự side 0, side 1                                  | `[1.80, 2.20]`                          |
| OddsLine / Dòng kèo          | Bộ odds của một tenant, kèm trạng thái, phase, thời gian và ID gốc   | Hàng SptPub trong bảng trên             |
| Room                         | Nơi giữ báo giá của các tenant cho cùng trận và market               | `room:cs2:alliance~sinners:game-winner` |
| Combo / Tổ hợp               | Chọn side 0 từ một tenant và side 1 từ tenant khác                   | `polymarket>0` kết hợp `sptpub>1`       |
| Leg / Chân                   | Một phía trong tổ hợp, có nguồn, cửa chọn và odds                    | Alliance thắng ở Polymarket, odds 2.10  |
| Margin                       | Lợi nhuận lý thuyết trên tổng vốn của tổ hợp, theo công thức backend | `0.02` là 2%                            |
| Signal / Kèo                 | Thông báo về cơ hội đạt điều kiện phát tín hiệu                      | Có `signalId`, hai chân và hạn hiệu lực |

### Về dữ liệu và vận hành

| Tên                       | Hiểu đơn giản                                                       | Vai trò                                                            |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Bản tin / Message         | Một lần task gửi dữ liệu về app                                     | Có thể chứa một giá, cả danh sách trận hoặc mốc kết thúc vòng quét |
| Payload                   | Phần dữ liệu nằm bên trong bản tin                                  | Nội dung parser cần đọc                                            |
| Publisher / Task          | Công việc chạy để lấy dữ liệu từ tenant                             | Lấy danh sách trận hoặc theo dõi giá                               |
| Kind                      | Loại công việc task thực hiện                                       | `polymarket.descriptor`, `polymarket.stream`                       |
| Descriptor                | Công việc lấy mô tả trận, market, token                             | Giúp app biết giá thuộc trận và đội nào                            |
| Stream / Feed             | Luồng giá cập nhật liên tục hoặc theo lần thăm dò                   | Cập nhật báo giá đang theo dõi                                     |
| Node                      | Máy chạy task từ xa                                                 | App gửi lệnh cho task thông qua node                               |
| Parser / Translator / ACL | Bộ phận đọc dữ liệu riêng của tenant và đổi sang dạng chung         | Dữ liệu hai nền tảng trở nên so sánh được                          |
| Lane / Làn                | Hàng xử lý cho một tenant và một phase                              | Ví dụ `sptpub:live`                                                |
| Evaluator                 | Bộ phận kiểm tra room và quyết định phát, làm mới hoặc hủy tín hiệu | Tìm cơ hội từ báo giá                                              |
| Consumer                  | Bot hoặc dịch vụ nhận tín hiệu từ app                               | Bot thông báo, dịch vụ giao dịch                                   |
| Delivery / ACK            | Một lần gửi thông báo / xác nhận đã nhận                            | Giúp theo dõi gửi lại và chống xử lý trùng                         |
| Incident / Sự cố          | Tình trạng vận hành được hệ thống theo dõi                          | Task chết, consumer mất kết nối                                    |
| Audit                     | Nhật ký thao tác API của người dùng                                 | Ai đã đổi cấu hình hoặc dừng task                                  |

**Bản tin, dòng kèo và tín hiệu là ba thứ khác nhau.** Một bản tin có thể không tạo dòng kèo nào, hoặc cập nhật nhiều dòng. Nhiều dòng kèo cũng chưa chắc tạo được tín hiệu.

## Dữ liệu đi qua những đâu

```text
Tenant -> Task -> Parser -> Lane -> Room -> Evaluator -> Consumer
```

1. **Tenant cung cấp dữ liệu.** SptPub và Polymarket có cấu trúc riêng.
2. **Task lấy dữ liệu rồi gửi bản tin.** Supervisor bổ sung thông tin task, thứ tự bản tin và thời điểm nhận.
3. **Parser đọc và chuẩn hóa.** Nó xác định môn, đội, market và odds. Kết quả có thể là `set`, `remove`, bỏ qua có chủ đích hoặc lỗi parse.
4. **Lane nhận cập nhật.** Các làn độc lập theo tenant và phase. Nếu đang bận mà có nhiều cập nhật cho cùng room và tenant, làn giữ bản mới nhất trong phần đang chờ. Số bản cũ được gộp nằm ở `coalesced`.
5. **Room được ghi báo giá.** `set` thêm hoặc thay báo giá hiện tại của tenant; `remove` gỡ báo giá của tenant khỏi room.
6. **Evaluator kiểm tra lại room.** Nó thử các tổ hợp hai chân, áp dụng ngưỡng lợi nhuận và chính sách tín hiệu. Một lượt quét định kỳ cũng đánh giá các room để làm mới tín hiệu đến hạn.
7. **Consumer nhận thông báo.** App gửi tín hiệu mới, tín hiệu làm mới hoặc thông báo hủy qua WebSocket. Consumer gửi ACK để xác nhận đã nhận.

Trang web dùng API và stream quản trị để quan sát các bước này. Bản tin trên stream quản trị dành cho web khác với bản tin giá từ task và bản tin tín hiệu gửi consumer.

## Room ghép dữ liệu như thế nào

### Một trận có thể có nhiều room

| Room                                          | Câu hỏi của market                 | Side 0 / Side 1                            |
| --------------------------------------------- | ---------------------------------- | ------------------------------------------ |
| `room:cs2:alliance~sinners:game-winner`       | Ai thắng trận?                     | Alliance thắng / Sinners thắng             |
| `room:cs2:alliance~sinners:map-1-winner`      | Ai thắng map 1?                    | Alliance thắng map 1 / Sinners thắng map 1 |
| `room:cs2:alliance~sinners:total-maps-2.5`    | Tổng map nhiều hơn hay ít hơn 2.5? | Over 2.5 / Under 2.5                       |
| `room:cs2:alliance~sinners:map-handicap-m1.5` | Ai thắng sau mức chấp map?         | Alliance -1.5 / Sinners +1.5               |

Tên hai đội được chuẩn hóa, áp dụng bí danh và sắp theo alphabet. Vì vậy hai tenant gửi đội theo thứ tự ngược nhau vẫn có thể vào cùng room; parser phải đảo odds và token tương ứng.

**Side 0 không phải lúc nào cũng là đội chủ nhà.** Với tổng map, side 0 là Over và side 1 là Under, không phụ thuộc tên đội. Với mức chấp, dấu của mức chấp được quy về đội đứng đầu trong khóa room.

### Room giữ báo giá hiện tại

Room có thể xuất hiện ngay khi mới có một tenant. Mỗi tenant có một dòng hiện tại trong room, không có một hàng mới cho mỗi bản tin. Phase là thuộc tính của dòng, không phải một phần của ID room.

Trong phiên bản này, ID room gồm môn, cặp đội và market; ID không chứa ngày hoặc giờ bắt đầu. Backend kiểm tra độ lệch giờ bắt đầu khi ghép hai báo giá và có tác vụ dọn các trận quá hạn.

### Đã ghép được chưa có nghĩa là có kèo

- **Matched:** room có ít nhất hai tenant. Hai dòng có thể đang tạm khóa hoặc lệch giờ.
- **Có tổ hợp hợp lệ:** hai dòng mở, khác tenant và giờ bắt đầu lệch trong giới hạn cho phép.
- **Đạt ngưỡng:** có tổ hợp đạt `minMargin`.
- **Có tín hiệu:** chính sách phát tín hiệu còn kiểm tra phase được bật và trạng thái tín hiệu trước đó.

Nếu tên đội khác nhau sau chuẩn hóa, hai nguồn có thể nằm ở hai room khác nhau. Trang [Ghép trượt](/ghep-truot) gợi ý cặp nghi ngờ; [Bí danh đội](/bi-danh) giúp khai báo tên chuẩn. Gợi ý không tự động hợp nhất room.

Khi bạn lưu bí danh, backend áp dụng ngay cho các dòng đang chạy và ghép lại room; không cần dừng publisher.
Nếu cả hai đội đều lệch tên, cần sửa cả hai. Xóa hoặc đổi bí danh cũng ghép lại theo bảng tên mới.
Giá vẫn giữ thời điểm nhận cũ, không biến thành báo giá mới chỉ vì đổi tên. Ghép được room rồi
vẫn phải qua các điều kiện phát kèo ở trên.

## Khi nào hệ thống phát kèo

Backend chọn side 0 từ tenant A và side 1 từ tenant B. A và B phải khác nhau; cả hai dòng phải `open`; giờ bắt đầu phải khớp trong `maxStartDriftMs`.

Trong ví dụ ban đầu, chọn Alliance ở Polymarket với `2.10`, Sinners ở SptPub với `2.20`:

```text
margin = 1 / (1 / oddsA + 1 / oddsB) - 1
       = 1 / (1 / 2.10 + 1 / 2.20) - 1
       ≈ 0.0744186 = 7.44%
```

Đây là công thức đang dùng trong code. Margin này chưa trừ phí, chưa kiểm tra khối lượng có thể khớp hoặc việc đặt lệnh thành công. Tín hiệu không phải xác nhận đã đặt cược.

### Chính sách tín hiệu

| Tình huống                                             | App làm gì?                                                |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| Chưa có tín hiệu; margin đạt ngưỡng; phase được bật    | Phát mới: `issued`, tạo `signalId`                         |
| Margin tăng đến mốc cao nhất đã phát cộng `marginStep` | Phát tín hiệu mới, thay tín hiệu cũ bằng `supersedes`      |
| Vẫn đạt ngưỡng và đã đến thời hạn làm mới              | `refreshed`, giữ `signalId`, cập nhật odds và hạn hiệu lực |
| Margin giảm nhưng vẫn đạt ngưỡng, chưa đến hạn làm mới | Không nhất thiết gửi thông báo mới                         |
| Margin xuống dưới ngưỡng                               | Hủy: `below_threshold`                                     |
| Một chân tạm khóa hoặc bị gỡ                           | Hủy: `leg_suspended` hoặc lý do gỡ tương ứng               |
| Giờ bắt đầu lệch quá giới hạn                          | Hủy: `start_time_mismatch`                                 |
| Phase của tổ hợp bị tắt                                | Hủy: `phase_disabled`                                      |

Một tổ hợp có tối đa một tín hiệu hiệu lực trong trạng thái của evaluator. Một room có thể có nhiều tổ hợp và nhiều tín hiệu. Nếu bất kỳ chân nào live, phase của tổ hợp là live.

## Đọc các chỉ số trên web

### Nhận cuối và Đổi cuối

| Nhãn                           | Khi nào mốc này cập nhật?                                | Nó chứng minh điều gì?                                                    |
| ------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| Nhận cuối / `lastReceivedAt`   | Ingest nhận bản tin thuộc kind có translator             | Dữ liệu đã đến bước ingest, kể cả bản tin sau đó bị bỏ qua hoặc parse lỗi |
| Đổi cuối / `lastChangeAt`      | Translator sinh ít nhất một cập nhật `set` hoặc `remove` | Bản tin đã tạo cập nhật báo giá; chưa chứng minh lane đã xử lý xong       |
| Xử lý cuối / `lastProcessedAt` | Lane kết thúc lượt xử lý                                 | Lane đã chạy lượt xử lý; lỗi riêng vẫn cần xem cùng các chỉ số khác       |

**Đổi cuối không chỉ đo lúc con số odds thay đổi.** `set` lại cùng odds, đổi trạng thái hoặc gỡ một dòng đều có thể cập nhật mốc này.

Ví dụ Nhận cuối là 2 giây trước, Đổi cuối là 5 phút trước: bản tin vẫn tới nhưng gần đây không tạo cập nhật báo giá. Có thể chỉ có bản tin bổ sung, dữ liệu không hỗ trợ, token chưa biết hoặc lỗi parse. Cần xem lý do, không thể chỉ từ hai mốc này kết luận API hỏng.

### Các bộ đếm không dùng cùng đơn vị

| Chỉ số              | Đếm cái gì?                                             |
| ------------------- | ------------------------------------------------------- |
| `received`          | Số bản tin ingest nhận                                  |
| `failed`            | Số lần translator ném ngoại lệ                          |
| `skipped`           | Số phần dữ liệu bị bỏ qua, theo từng lý do              |
| `set` / `remove`    | Số cập nhật báo giá translator sinh ra                  |
| `queued`            | Số cập nhật đang chờ trong lane                         |
| `processed`         | Số cập nhật lane đã chạy qua lượt xử lý                 |
| `coalesced`         | Số cập nhật cũ trong hàng chờ được gộp vì đã có bản mới |
| `activeSignals`     | Số tín hiệu đang hiệu lực ở thời điểm lấy dữ liệu       |
| `pendingDeliveries` | Số lần gửi consumer còn chờ ACK                         |

Một trang descriptor là **một bản tin** nhưng có thể chứa hàng trăm market. Vì vậy `set` hoặc `skipped` có thể lớn hơn `received`. Không nên xem mọi bộ đếm là các phần của cùng một tổng.

Các bộ đếm ingest và lane cộng dồn từ khi backend khởi động; `since` cho biết mốc bắt đầu. Tốc độ trên web được tính từ chênh lệch giữa các lần lấy mẫu. Số dòng hiện tại trong room và số tín hiệu hiện tại là trạng thái tại thời điểm xem, không phải số đã phát từ lúc khởi động.

**100% bên cạnh một lý do trong nhóm Lỗi nghĩa là lý do đó chiếm toàn bộ nhóm Lỗi**, không có nghĩa 100% bản tin nhận bị lỗi.

### Các lý do bỏ qua

| Mã                   | Hiểu đơn giản                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `parse_failed`       | Dữ liệu không khớp schema parser đang đọc                                                     |
| `unsupported_event`  | Bản tin stream hợp lệ nhưng không dùng để cập nhật odds: giao dịch cuối, bước giá, market mới |
| `unsupported_sport`  | Môn chưa hỗ trợ                                                                               |
| `unsupported_market` | Loại cược chưa hỗ trợ                                                                         |
| `unsupported_line`   | Mức chấp, mốc tổng hoặc số map ngoài danh sách hỗ trợ                                         |
| `missing_fields`     | Thiếu ID, giờ bắt đầu, token hoặc dữ liệu cần thiết                                           |
| `same_team_names`    | Hai đội trở thành cùng một tên sau chuẩn hóa                                                  |
| `no_moneyline_teams` | Không xác định được cặp đội từ market thắng trận để gắn market tổng                           |
| `invalid_event`      | Sự kiện không phải trận hợp lệ theo quy tắc translator                                        |
| `unknown_asset`      | Stream gửi token chưa có trong bảng định tuyến của descriptor                                 |

Bỏ qua có chủ đích không phải ngoại lệ xử lý. Với Polymarket, cần descriptor nhận diện market và token trước khi stream có thể cập nhật đúng room.

## ID nào của tenant, ID nào của app

**`tAlliance` trong các ví dụ trò chuyện trước là tên mình tự đặt.** Chữ `t` chỉ gợi nhớ token, không phải tiền tố Polymarket gửi và cũng không phải quy tắc domain của app. Trong tài liệu này, ID token dạng số ngắn chỉ là minh họa; ID thực thường là chuỗi số dài.

| Trường hoặc ID                          | Ai đặt?              | App làm gì với nó?                                                        |
| --------------------------------------- | -------------------- | ------------------------------------------------------------------------- |
| Token ID / Asset ID của Polymarket      | Tenant               | Giữ nguyên giá trị để subscribe stream và xác định outcome                |
| Condition ID của Polymarket             | Tenant               | Nhận diện market gốc                                                      |
| `asset_id` thành `assetId`              | SDK Polymarket       | Chuẩn hóa tên trường; không thêm chữ `t` vào ID                           |
| `ref.t0`, `ref.t1`                      | App đặt tên trường   | Lưu nguyên token ID theo side 0 và side 1 của room                        |
| `ref.c`, `ref.slug`                     | App đặt tên trường   | Lưu condition ID và slug lấy từ tenant                                    |
| `room:cs2:alliance~sinners:game-winner` | App                  | Gom báo giá theo môn, đội chuẩn hóa và market chuẩn                       |
| `comboId`                               | App                  | Ghi tenant nào cung cấp side nào; ví dụ `polymarket>0` kết hợp `sptpub>1` |
| `signalId`                              | App                  | Định danh tín hiệu; evaluator tạo UUID khi phát mới                       |
| `deliveryId`                            | Consumer hub của app | Định danh một lần giao thông báo để nhận ACK                              |

Khóa `t0` nghĩa là **trường chứa token của phía 0**. Nó không có nghĩa giá trị token ID phải bắt đầu bằng `t0`.

## Payload minh họa

Các JSON dưới đây là ví dụ rút gọn để đọc cấu trúc, không phải dữ liệu live hoặc ID để sử dụng đặt lệnh. Timestamp dùng đơn vị mili giây.

### Bản tin nhận vào

Supervisor chuyển cho ingest một `TaskDataMessage`. `payload` bên ngoài là dữ liệu task gửi; `payload` bên trong là nội dung event mà SDK Polymarket chuẩn hóa.

```json
{
  "taskId": "poly-stream",
  "tenant": "polymarket",
  "kind": "polymarket.stream",
  "seq": 42,
  "sentAt": 1790318269481,
  "receivedAt": 1790318269500,
  "channel": "market",
  "payload": {
    "topic": "market",
    "type": "best_bid_ask",
    "payload": {
      "assetId": "123456789",
      "bestBid": "0.24",
      "bestAsk": "0.25"
    }
  }
}
```

Nhận cuối cập nhật. Nếu descriptor đã biết token `123456789` thuộc Alliance, parser lấy ask `0.25` và đổi thành decimal odds `1 / 0.25 = 4`.

### Cập nhật báo giá sinh ra

Giả sử token phía còn lại là `987654321`, có ask `0.50`. Kết quả `set` tương đương biểu diễn rút gọn sau:

```json
{
  "type": "set",
  "key": "room:cs2:alliance~sinners:game-winner",
  "line": {
    "tenant": "polymarket",
    "odds": [4, 2],
    "status": "open",
    "phase": "live",
    "updatedAt": 1790318269481,
    "startsAt": 1790310000000,
    "ref": {
      "c": "CONDITION_ID_MINH_HOA",
      "slug": "cs2-alliance-sinners",
      "t0": "123456789",
      "t1": "987654321"
    }
  }
}
```

Trong code, `key` là đối tượng `MatchKey`, `line` là `OddsLine`; JSON trên trình bày `key.toString()` và `line.props`. Đây không phải một response REST nguyên bản. Đổi cuối cập nhật ngay khi parser sinh kết quả này, trước khi lane ghi nó vào room.

### Bản tin hợp lệ nhưng không đổi báo giá

```json
{
  "topic": "market",
  "type": "last_trade_price",
  "payload": {
    "assetId": "123456789",
    "price": "0.23",
    "side": "BUY",
    "size": "100"
  }
}
```

Đây là phần `TaskDataMessage.payload`. `price` là giá của giao dịch đã khớp, không phải ask hiện tại. Nhận cuối cập nhật, `unsupported_event` tăng, Đổi cuối giữ nguyên. `tick_size_change` và `new_market` hợp lệ cũng được bỏ qua theo cách này.

### Market đã kết thúc

```json
{
  "topic": "market",
  "type": "market_resolved",
  "payload": { "assetIds": ["123456789", "987654321"] }
}
```

Nếu market đang được theo dõi, parser sinh `remove` cho báo giá Polymarket. Cả Nhận cuối và Đổi cuối đều cập nhật; evaluator kiểm tra để hủy những tín hiệu dựa vào chân đã mất. Nếu token chưa biết, không có báo giá tương ứng để gỡ.

### Descriptor và vòng quét

`polymarket.descriptor` gửi `cycle-start`, sau đó từng trang event qua channel `events`, cuối cùng `cycle-complete` nếu đã quét hết mà không lỗi. Trang `events` chứa một mảng event; mỗi event có schedule, sport và danh sách market.

```json
{
  "channel": "cycle-complete",
  "payload": { "cycle": 3, "pages": 2 }
}
```

Đây là mảnh rút gọn của bản tin task. Mốc hoàn tất không phải lỗi parse. Nó cho phép parser đối chiếu market nào biến mất khỏi danh sách. Polymarket mặc định chờ vắng hai vòng liên tiếp mới gỡ; khi tỷ lệ gỡ bất thường, cơ chế đối chiếu có thể giữ lại thêm một số vòng và báo sự cố.

## Consumer nhận tín hiệu thế nào

Consumer là đầu ra của hệ thống. Một frame tín hiệu gồm `deliveryId`, `kind` và `signal`. Trong `signal` có `signalId`, room, tổ hợp, margin, hai chân, `issuedAt` và `expiresAt`.

```json
{
  "type": "signal",
  "deliveryId": "DELIVERY_ID_MINH_HOA",
  "kind": "issued",
  "signal": {
    "signalId": "SIGNAL_ID_MINH_HOA",
    "room": "room:cs2:alliance~sinners:game-winner",
    "sport": "cs2",
    "market": "game-winner",
    "teams": ["alliance", "sinners"],
    "comboId": "polymarket>0|sptpub>1",
    "phase": "live",
    "margin": 0.0744186,
    "legs": [
      {
        "tenant": "polymarket",
        "side": 0,
        "pick": "alliance",
        "odds": 2.1,
        "ref": {}
      },
      {
        "tenant": "sptpub",
        "side": 1,
        "pick": "sinners",
        "odds": 2.2,
        "ref": {}
      }
    ],
    "issuedAt": 1790318269500,
    "expiresAt": 1790318299500
  }
}
```

`ref` được để trống cho gọn ví dụ; dữ liệu thực chứa các ID gốc để consumer xác định đúng market và outcome. Consumer xác nhận lần giao bằng:

```json
{ "type": "ack", "deliveryId": "DELIVERY_ID_MINH_HOA" }
```

Hub gửi lại những thông báo còn chờ ACK trong cửa sổ hiệu lực. Vì vậy consumer có thể nhận lại cùng thông báo và cần xử lý trùng. ACK xác nhận đã nhận thông báo, không chứng minh đặt lệnh thành công.

### Pause, resume và mất kết nối

- **Pause:** ngừng giao tín hiệu mới hoặc làm mới cho consumer đó. Thông báo hủy và thông báo đã chờ ACK vẫn có thể tiếp tục được gửi.
- **Resume:** bỏ trạng thái pause để nhận các lần phát tiếp theo. Lệnh resume hiện không tự phát lại ngay toàn bộ tín hiệu active.
- **Kết nối lại:** hub có cơ chế phát lại tín hiệu còn hiệu lực khi consumer kết nối và không bị pause.
- **Consumer offline:** có thể đổi pause/resume của session đã biết; trạng thái được hub giữ trong RAM. Mất kết nối và pause là hai trạng thái khác nhau.

Backend phát hiện và giao tín hiệu. Việc thông báo ra ngoài hoặc đặt lệnh thuộc phần triển khai của consumer; chỉ nhìn thấy kèo trên web chưa có nghĩa consumer đã hành động.

## Cài đặt và các màn hình

### Cài đặt arbitrage

Đây là giá trị mặc định trong code; giá trị đang chạy cần xem ở [Cài đặt arbitrage](/cai-dat).

| Trường            | Ý nghĩa                                                          | Mặc định                  |
| ----------------- | ---------------------------------------------------------------- | ------------------------- |
| `minMargin`       | Lợi nhuận tối thiểu để phát tín hiệu                             | `0.02` = 2%               |
| `marginStep`      | Mức tăng so với mốc cao nhất đã phát để tạo tín hiệu thay thế    | `0.01` = 1 điểm phần trăm |
| `signalTtlMs`     | Khoảng hiệu lực của tín hiệu và mốc làm mới khi còn đủ điều kiện | `30000` = 30 giây         |
| `maxStartDriftMs` | Độ lệch giờ bắt đầu tối đa giữa hai nguồn                        | `1200000` = 20 phút       |
| `enabledPhases`   | Phase được phép phát tín hiệu                                    | `live`, `prematch`        |

`prematch` nghĩa là trước trận; `live` nghĩa là đang diễn ra. Dòng `suspended` vẫn có thể nằm trong room nhưng không được ghép để tạo cơ hội. Với Polymarket, thiếu ask dùng được ở một phía sẽ tạo dòng suspended; giá 0 hoặc 1 không được dùng để tính odds mở.

Adapter cấu hình hiện tại giữ cài đặt trong RAM. Restart backend đưa cài đặt arbitrage về mặc định. Trạng thái tín hiệu active và các session consumer cũng được giữ trong RAM; không nên nhầm chúng với lịch sử đã lưu.

### Mở màn hình nào để xem việc gì?

| Màn hình                       | Xem hoặc thao tác                                                            |
| ------------------------------ | ---------------------------------------------------------------------------- |
| [Tổng quan](/)                 | Tình trạng chung của hệ thống                                                |
| [Luồng dữ liệu](/ingest)       | Nhận, bỏ qua, lỗi, cập nhật báo giá và các làn xử lý                         |
| [Trận đấu](/tran-dau)          | Các market của một trận và báo giá từng tenant                               |
| [Ghép trượt](/ghep-truot)      | Cặp trận có thể bị tách do tên đội lệch; ẩn cặp là lựa chọn trên trình duyệt |
| [Kèo](/keo)                    | Tín hiệu active và lịch sử tín hiệu                                          |
| [Publisher & Node](/publisher) | Task, node, bắt đầu, dừng, xóa task đã dừng hoặc lỗi; lệnh tùy kind          |
| [Consumer](/consumer)          | Kết nối, pause/resume và số thông báo chờ ACK                                |
| [Sự cố](/su-co)                | Sự cố đang mở và xác nhận đã xem                                             |
| [Audit](/audit)                | Nhật ký thao tác API                                                         |
| [Lịch sử odds](/lich-su-odds)  | Chuyển trạng thái báo giá như open, suspended hoặc removed                   |
| [Bí danh đội](/bi-danh)        | Thêm hoặc xóa cách quy tên khác nhau về tên chuẩn                            |

API chưa có lệnh restart task riêng. Thao tác Tạo lại trên web là xóa hồ sơ task đã dừng/lỗi rồi tạo mới với spec cũ. ACK sự cố chỉ đánh dấu đã xem, không sửa nguyên nhân gây sự cố.

Web yêu cầu đăng nhập và chuyển tiếp các thao tác backend qua BFF bằng token cấu hình phía server. Quyền API quyết định thao tác nào được phép. Khi dùng `ARB_MOCK=true`, dữ liệu và kết quả thao tác là dữ liệu mẫu, không chứng minh pipeline thật đang chạy.

## Khi thấy số liệu khác kỳ vọng

| Hiện tượng                                   | Kiểm tra đầu tiên                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Có bản tin nhưng Đổi cuối không mới          | Xem `skipped` theo kind; phân biệt bản tin bổ sung, token lạ và lỗi schema                       |
| `parse_failed` tăng                          | Xác định descriptor hay stream; lấy mẫu payload, so đường dẫn trường với schema                  |
| `unknown_asset` tăng                         | Descriptor đã có market và token chưa? Stream có đang nhận token ngoài tập theo dõi không?       |
| Có hai tenant mà không có kèo                | Kiểm tra trạng thái open, cùng market, giờ bắt đầu, phase và margin                              |
| Cùng trận ngoài đời nhưng nằm ở hai room     | Kiểm tra tên chuẩn hóa, bí danh và loại market                                                   |
| `coalesced` tăng                             | Làn đang gộp cập nhật cũ; xem kèm queued, thời gian xử lý và lỗi, không kết luận đó là parse lỗi |
| Consumer connected nhưng không nhận tín hiệu | Kiểm tra pause, tín hiệu active, thời hạn và các lần phát tiếp theo                              |
| `pendingDeliveries` tăng                     | Consumer có gửi ACK đúng deliveryId không? Có đang mất kết nối không?                            |
| Cấu hình vừa đổi bị mất sau restart          | Adapter cài đặt hiện giữ trong RAM                                                               |

Nếu chạy trong repo, có thể lấy mẫu API và stream công khai của Polymarket bằng:

```bash
pnpm exec tsx scripts/diagnose-polymarket-ingest.ts
```

Công cụ này kiểm tra mẫu descriptor và stream theo schema hiện tại; nó không đọc lịch sử payload của backend đang chạy.

### Các file định nghĩa hành vi

| Chủ đề                       | File trong repo                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Bản tin task                 | `src/modules/tasks/application/task-protocol.ts`                                   |
| Báo giá và room              | `src/modules/odds/domain/odds-line.ts`, `odds-room.ts`, `match-key.ts`             |
| Công thức margin và tín hiệu | `src/modules/odds/domain/arbitrage-opportunity.ts`, `signal-policy.ts`             |
| Đếm ingest                   | `src/modules/odds/application/ingest-stats.ts`                                     |
| Lane và evaluator            | `src/modules/odds/application/lane-dispatcher.ts`, `arbitrage-evaluator.ts`        |
| Parser Polymarket            | `src/modules/odds/infrastructure/acl/polymarket/`                                  |
| Giao tín hiệu và ACK         | `src/modules/odds/infrastructure/consumer/consumer-hub.ts`, `consumer-protocol.ts` |
| API                          | `docs/API.md`, Swagger tại `/docs` trên backend khi được bật                       |

Tài liệu mô tả triển khai hiện tại của repo. Khi thay đổi mapping, chính sách hoặc adapter lưu trữ, cần cập nhật mục tương ứng.
