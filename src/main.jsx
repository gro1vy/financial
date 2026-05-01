import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

const todayIso = toIso(new Date());

function isoWeekKey(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  const day = value.getDay() || 7;
  value.setDate(value.getDate() + 4 - day);
  const yearStart = new Date(value.getFullYear(), 0, 1);
  const week = Math.ceil(((value - yearStart) / 86400000 + 1) / 7);
  return `${value.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function dateFromWeekKey(key) {
  const [yearPart, weekPart] = key.split("-W");
  const year = Number(yearPart);
  const week = Number(weekPart);
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const day = simple.getDay() || 7;
  const monday = new Date(simple);
  monday.setDate(simple.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function addDays(date, count) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

function toIso(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function money(value) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(value || 0));
}

function api(path, options = {}) {
  return fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  }).catch(() => {
    const error = new Error("Не удалось связаться с сервером. Проверь подключение или перезапусти приложение.");
    error.status = 0;
    throw error;
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Сервер вернул ошибку ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  });
}

function buildWeekModel(weekKey, week) {
  const start = dateFromWeekKey(weekKey);
  const base = Number(week?.budget || 0) / 7;
  let previousDiff = 0;
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    const iso = toIso(date);
    const expenses = (week?.expenses || []).filter((expense) => expense.date === iso);
    const spent = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const allowed = Math.max(0, base + previousDiff);
    const diff = allowed - spent;
    previousDiff = iso < todayIso ? diff : 0;
    return { index, date, iso, expenses, spent, allowed, diff };
  });
}

function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [weekKey, setWeekKey] = useState(isoWeekKey());
  const [week, setWeek] = useState(null);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState("");
  const [modal, setModal] = useState(null);

  useEffect(() => {
    api("/api/me")
      .then(({ user }) => {
        setUser(user);
        setAuthError("");
      })
      .catch((error) => {
        if (error.status !== 401) setAuthError(error.message);
        setUser(null);
      })
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!user) return;
    api(`/api/week?key=${weekKey}`)
      .then(({ week }) => {
        setWeek(week);
        setError("");
      })
      .catch((error) => setError(`Не удалось загрузить неделю: ${error.message}`));
  }, [user, weekKey]);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const days = useMemo(() => (week ? buildWeekModel(weekKey, week) : []), [weekKey, week]);
  const currentDay = days.find((day) => day.iso === todayIso) || days[0];
  const expenseTitles = user.expenseTitles || [];

  function showServerError(action, error) {
    setError(`${action}: ${error.message}`);
  }

  async function saveBudget(budget, rememberBudget) {
    try {
      const data = await api("/api/week/budget", { method: "PUT", body: { key: weekKey, budget, rememberBudget } });
      setWeek(data.week);
      setUser(data.user);
      setModal(null);
      setError("");
    } catch (error) {
      showServerError("Не удалось сохранить бюджет", error);
    }
  }

  async function saveExpense(expense) {
    try {
      const data = await api("/api/expenses", { method: "POST", body: { ...expense, key: weekKey } });
      setWeek(data.week);
      setUser(data.user);
      setModal(null);
      setError("");
    } catch (error) {
      showServerError("Не удалось добавить трату", error);
    }
  }

  async function removeExpense(id) {
    try {
      const data = await api(`/api/expenses/${id}?key=${weekKey}`, { method: "DELETE" });
      setWeek(data.week);
      setError("");
    } catch (error) {
      showServerError("Не удалось удалить трату", error);
    }
  }

  async function saveSettings(settings) {
    try {
      const data = await api("/api/settings", { method: "PUT", body: settings });
      setUser(data.user);
      setModal(null);
      setError("");
    } catch (error) {
      showServerError("Не удалось сохранить настройки", error);
    }
  }

  async function logout() {
    try {
      await api("/api/logout", { method: "POST" });
      setUser(null);
      setError("");
    } catch (error) {
      showServerError("Не удалось выйти", error);
    }
  }

  if (!authReady) return <Splash />;
  if (!user) return <Auth onAuth={setUser} initialError={authError} />;
  if (!week) return <Splash />;

  const needsBudget = week.budget === null || week.budget === undefined;

  return (
    <main className="app-shell">
      <TopBar
        user={user}
        weekKey={weekKey}
        days={days}
        onPrev={() => setWeekKey(isoWeekKey(addDays(dateFromWeekKey(weekKey), -7)))}
        onNext={() => setWeekKey(isoWeekKey(addDays(dateFromWeekKey(weekKey), 7)))}
        onSettings={() => setModal("settings")}
        onLogout={logout}
      />

      <WeekStrip days={days} selectedIso={currentDay?.iso} />

      <section className="summary">
        <div>
          <span className="label">Бюджет недели</span>
          <strong>{money(week.budget)} ₽</strong>
        </div>
        <button className="ghost-button" onClick={() => setModal("budget")}>Изменить</button>
      </section>

      <section className="day-list">
        {days.map((day) => (
          <DayRow key={day.iso} day={day} onRemove={removeExpense} />
        ))}
      </section>

      <Stats days={days} />

      <button className="fab" aria-label="Добавить трату" onClick={() => setModal("expense")}>+</button>

      {error && <div className="toast" onClick={() => setError("")}>{error}</div>}
      {(needsBudget || modal === "budget") && <BudgetModal user={user} onSave={saveBudget} initial={week.budget ?? user.settings.defaultBudget ?? ""} />}
      {modal === "expense" && <ExpenseModal days={days} titles={expenseTitles} onClose={() => setModal(null)} onSave={saveExpense} />}
      {modal === "settings" && <SettingsModal user={user} onClose={() => setModal(null)} onSave={saveSettings} />}
    </main>
  );
}

function Splash() {
  return <div className="center-screen"><div className="loader" /></div>;
}

function Auth({ onAuth, initialError = "" }) {
  const [mode, setMode] = useState("login");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);

  useEffect(() => {
    setError(initialError);
  }, [initialError]);

  async function submit(event) {
    event.preventDefault();
    try {
      const data = await api(mode === "login" ? "/api/login" : "/api/register", { method: "POST", body: { login, password } });
      setError("");
      onAuth(data.user);
    } catch (error) {
      setError(error.message);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <div className="brand-mark">₽</div>
        <h1>Финансы недели</h1>
        <p>Ровный недельный бюджет, понятный лимит на день и быстрый учет трат.</p>
        <form onSubmit={submit}>
          <label>Логин<input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" /></label>
          <label>Пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button">{mode === "login" ? "Войти" : "Создать аккаунт"}</button>
        </form>
        <button className="link-button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "Нужен новый аккаунт" : "У меня уже есть аккаунт"}
        </button>
      </section>
    </main>
  );
}

function TopBar({ user, weekKey, days, onPrev, onNext, onSettings, onLogout }) {
  const start = days[0]?.date || dateFromWeekKey(weekKey);
  const weekNumber = weekKey.split("-W")[1];
  return (
    <header className="top-bar">
      <div className="top-actions">
        <button className="icon-button" aria-label="Настройки" onClick={onSettings}>⚙</button>
        <span>{user.login}</span>
        <button className="icon-button" aria-label="Выйти" onClick={onLogout}>↪</button>
      </div>
      <div className="week-title">
        <button className="nav-button" aria-label="Предыдущая неделя" onClick={onPrev}>‹</button>
        <div>
          <strong>{monthNames[start.getMonth()]} {start.getFullYear()}</strong>
          <span>{weekNumber}-я неделя</span>
        </div>
        <button className="nav-button" aria-label="Следующая неделя" onClick={onNext}>›</button>
      </div>
    </header>
  );
}

function WeekStrip({ days }) {
  return (
    <nav className="week-strip">
      {days.map((day) => {
        const isToday = day.iso === todayIso;
        return (
          <div className={isToday ? "week-day active" : "week-day"} key={day.iso}>
            <span>{dayNames[day.index]}</span>
            <strong>{day.date.getDate()}</strong>
          </div>
        );
      })}
    </nav>
  );
}

function DayRow({ day, onRemove }) {
  const isFuture = day.iso > todayIso;
  const over = day.diff < 0;
  return (
    <article className="day-row">
      <div className="day-head">
        <div>
          <span className="label">{dayNames[day.index]}, {day.date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</span>
          <strong>{money(day.allowed)} ₽ можно потратить</strong>
        </div>
        {!isFuture && (
          <div className={over ? "delta bad" : "delta good"}>
            <span>{over ? "↑" : "↓"}</span>{money(Math.abs(day.diff))} ₽
          </div>
        )}
      </div>
      {day.expenses.length > 0 ? (
        <div className="expenses">
          {day.expenses.map((expense) => (
            <div className="expense" key={expense.id}>
              <div><strong>{expense.title || "Без названия"}</strong></div>
              <div><b>{money(expense.amount)} ₽</b><button aria-label="Удалить" onClick={() => onRemove(expense.id)}>×</button></div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-day">Трат нет</p>
      )}
    </article>
  );
}

function Stats({ days }) {
  const width = 330;
  const height = 210;
  const pad = 28;
  const max = Math.max(1, ...days.flatMap((day) => [day.spent, day.allowed]));
  const point = (day, value) => {
    const x = pad + (day.index * (width - pad * 2)) / 6;
    const y = height - pad - (value / max) * (height - pad * 2);
    return [x, y];
  };
  const spentLine = days.map((day) => point(day, day.spent).join(",")).join(" ");
  const allowedLine = days.map((day) => point(day, day.allowed).join(",")).join(" ");

  return (
    <section className="stats">
      <div className="section-head">
        <h2>Статистика</h2>
        <span>по дням</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="График трат по дням">
        {[0, 1, 2, 3].map((line) => (
          <line key={line} x1={pad} x2={width - pad} y1={pad + line * 45} y2={pad + line * 45} className="grid-line" />
        ))}
        {days.map((day) => {
          const [x] = point(day, 0);
          return <line key={day.iso} x1={x} x2={x} y1={pad} y2={height - pad} className="grid-line vertical" />;
        })}
        <polyline points={allowedLine} className="allowed-line" />
        <polyline points={spentLine} className="spent-line" />
        {days.map((day) => {
          const [x, y] = point(day, day.spent);
          const ok = day.spent <= day.allowed;
          return <circle key={day.iso} cx={x} cy={y} r="5.5" className={ok ? "dot good-dot" : "dot bad-dot"} />;
        })}
        {days.map((day) => {
          const [x] = point(day, 0);
          return <text key={day.iso} x={x} y={height - 6} textAnchor="middle">{dayNames[day.index]}</text>;
        })}
      </svg>
      <div className="legend">
        <span><i className="spent-swatch" />Факт</span>
        <span><i className="allowed-swatch" />Можно</span>
      </div>
    </section>
  );
}

function BudgetModal({ user, initial, onSave }) {
  const [budget, setBudget] = useState(initial);
  const [remember, setRemember] = useState(Boolean(user.settings.rememberBudget));
  return (
    <Modal title="Бюджет недели">
      <label>Сумма на неделю<input inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} autoFocus /></label>
      <label className="check-row"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />Запомнить для следующих недель</label>
      <button className="primary-button" onClick={() => onSave(Number(budget), remember)}>Сохранить</button>
    </Modal>
  );
}

function ExpenseModal({ days, titles, onClose, onSave }) {
  const defaultDate = days.some((day) => day.iso === todayIso) ? todayIso : days[0]?.iso;
  const [date, setDate] = useState(defaultDate);
  const [amount, setAmount] = useState("");
  const [titleMode, setTitleMode] = useState(titles[0] || "__new");
  const [customTitle, setCustomTitle] = useState("");
  const title = titleMode === "__new" ? customTitle : titleMode;

  return (
    <Modal title="Новая трата" onClose={onClose}>
      <label>Дата<select value={date} onChange={(event) => setDate(event.target.value)}>{days.map((day) => <option value={day.iso} key={day.iso}>{dayNames[day.index]}, {day.date.getDate()}</option>)}</select></label>
      <label>Название<select value={titleMode} onChange={(event) => setTitleMode(event.target.value)}>
        {titles.map((item) => <option value={item} key={item}>{item}</option>)}
        <option value="__new">Новое название</option>
      </select></label>
      {titleMode === "__new" && <label>Новое название<input value={customTitle} onChange={(event) => setCustomTitle(event.target.value)} placeholder="Например, кофе" autoFocus /></label>}
      <label>Сумма<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" /></label>
      <button className="primary-button" onClick={() => onSave({ date, amount: Number(amount), title: title.trim() })}>Добавить</button>
    </Modal>
  );
}

function SettingsModal({ user, onClose, onSave }) {
  const [rememberBudget, setRememberBudget] = useState(Boolean(user.settings.rememberBudget));
  const [defaultBudget, setDefaultBudget] = useState(user.settings.defaultBudget ?? "");
  return (
    <Modal title="Настройки" onClose={onClose}>
      <label className="check-row"><input type="checkbox" checked={rememberBudget} onChange={(event) => setRememberBudget(event.target.checked)} />Запоминать бюджет</label>
      <label>Бюджет по умолчанию<input inputMode="decimal" value={defaultBudget} onChange={(event) => setDefaultBudget(event.target.value)} /></label>
      <button className="primary-button" onClick={() => onSave({ rememberBudget, defaultBudget: defaultBudget === "" ? null : Number(defaultBudget) })}>Сохранить</button>
    </Modal>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop">
      <section className="modal">
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && <button className="icon-button" aria-label="Закрыть" onClick={onClose}>×</button>}
        </div>
        {children}
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
