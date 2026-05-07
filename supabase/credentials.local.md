# RunLink · Supabase credentials (local reference)

> 这个文件保存项目凭据，方便开发时查阅。
> `anon` key 和 `publishable` key 设计为**可公开**（安全由 RLS 保证），
> 所以即使提交到 public GitHub 仓库也不会造成数据泄漏。
> **但 test user 的密码请不要提交**。生产部署前把这个文件加到 .gitignore。

---

## Supabase project

| 项 | 值 |
|---|---|
| Project ID / ref | `iqwfwdfcediizoapcmat` |
| Project URL | `https://iqwfwdfcediizoapcmat.supabase.co` |
| Region | `ap-northeast-1` (Tokyo) |
| Organization | `MingxuanTong's Org` |
| Plan | Free |
| Dashboard | <https://supabase.com/dashboard/project/iqwfwdfcediizoapcmat> |

## API keys

**Recommended — modern publishable key** (用这个):
```
sb_publishable_uuZn2VzDNoViiKOcqJfdFA_9YeqRAN6
```

**Legacy anon JWT** (兼容老库时可以用):
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlxd2Z3ZGZjZWRpaXpvYXBjbWF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NjUzNDIsImV4cCI6MjA5MjI0MTM0Mn0.hgUBk2_TgYO0_rEN_jaOS0CgDU53UtohGaIcA6XfPac
```

> `@supabase/supabase-js` v2 两种 key 都识别；新项目直接用 publishable key。

## Frontend snippet

前端 `scripts/supabase.js` 里这样初始化：

```js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const supabase = createClient(
  'https://iqwfwdfcediizoapcmat.supabase.co',
  'sb_publishable_uuZn2VzDNoViiKOcqJfdFA_9YeqRAN6'
);
```

---

## Test user

| 项 | 值 |
|---|---|
| Email | `demo@runlink.test` |
| Password | `Demo12345!` |
| User ID | `364c7022-0728-4752-977d-5e2f42bd4ea6` |
| Confirmed | true (auto) |
| Role | Demo owner of both seeded clubs |

---

## Seeded data summary

| 表 | 行数 | 说明 |
|---|---|---|
| `auth.users` | 1 | demo@runlink.test |
| `profiles` | 1 | Demo Runner（触发器自动创建） |
| `clubs` | 2 | DEMO Go Runners Shanghai · DEMO Beijing Pacers |
| `club_members` | 2 | demo 用户作为两个俱乐部的 owner（触发器自动加入） |
| `activities` | 6 | 5 个 published（未来）+ 1 个 completed（过去 5 天） |
| `runs` | 3 | demo 用户的 3 条跑步记录，本月里程榜有数据 |

## 活动分布

Shanghai 俱乐部：
- `Sunset Bund 5K` — 2 天后
- `Weekend Long Run 10K` — 5 天后
- `Tuesday Track Intervals` — 9 天后
- `Last Weekend 5K` — 5 天前（`status = completed`，用来测 reflections）

Beijing 俱乐部：
- `Olympic Park Morning 8K` — 3 天后
- `Hill Repeats - Xiangshan` — 7 天后

---

## 待办（dashboard-only，SQL 改不了）

- [ ] **Authentication → Policies → Leaked Password Protection**：建议开（connects to haveibeenpwned.org）
- [ ] **Authentication → Providers → Email**：开发阶段可关闭 Confirm email 让注册更快
- [ ] （可选）开启 **Google OAuth** provider 让前端能一键用 Google 登录
