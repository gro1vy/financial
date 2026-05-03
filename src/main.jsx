import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

const todayIso = toIso(new Date());
const currentMonthKey = toMonthKey(new Date());

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

function toMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dateFromMonthKey(key) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function monthLabel(key) {
  const date = dateFromMonthKey(key);
  return `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
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
    previousDiff = iso <= todayIso || spent > 0 ? diff : 0;
    return { index, date, iso, expenses, spent, allowed, diff };
  });
}

function buildMonthModel(monthKey, month, dynamicExpenses, wallet) {
  const start = dateFromMonthKey(monthKey);
  const daysCount = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const items = month?.items || [];
  const dynamicItems = (dynamicExpenses || []).map((expense) => ({
    id: expense.id,
    date: expense.date,
    title: expense.title || "Динамическая трата",
    amount: Number(expense.amount || 0),
    type: "expense",
    flow: "dynamic",
  }));
  const allItems = [...items, ...dynamicItems];
  const netByDate = new Map();

  allItems.forEach((item) => {
    const amount = Number(item.actualAmount ?? item.amount ?? 0);
    const signed = item.type === "income" ? amount : -amount;
    netByDate.set(item.date, (netByDate.get(item.date) || 0) + signed);
  });

  const currentBalance = Number(wallet?.balance ?? 0);
  const isCurrentMonth = monthKey === currentMonthKey;
  const beforeOrTodayNet = [...netByDate.entries()]
    .filter(([date]) => date <= todayIso)
    .reduce((sum, [, net]) => sum + net, 0);
  const startBalance = wallet?.balance === null || wallet?.balance === undefined
    ? 0
    : isCurrentMonth ? currentBalance - beforeOrTodayNet : currentBalance;

  let running = startBalance;
  const days = Array.from({ length: daysCount }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), index + 1);
    const iso = toIso(date);
    const dayItems = allItems.filter((item) => item.date === iso);
    const income = dayItems.filter((item) => item.type === "income").reduce((sum, item) => sum + Number(item.actualAmount ?? item.amount ?? 0), 0);
    const expense = dayItems.filter((item) => item.type !== "income").reduce((sum, item) => sum + Number(item.actualAmount ?? item.amount ?? 0), 0);
    const balanceBefore = running;
    running += income - expense;
    return { date, iso, index, items: dayItems, income, expense, net: income - expense, balanceBefore, balanceAfter: running };
  });

  return { days, startBalance, endBalance: running, items };
}

function monthWeeks(days) {
  const groups = [];
  days.forEach((day) => {
    const weekStart = toIso(addDays(day.date, -((day.date.getDay() || 7) - 1)));
    const current = groups[groups.length - 1];
    if (!current || current.weekStart !== weekStart) groups.push({ weekStart, days: [] });
    groups[groups.length - 1].days.push(day);
  });
  return groups;
}

function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");
  const [weekKey, setWeekKey] = useState(isoWeekKey());
  const [week, setWeek] = useState(null);
  const [monthKeyState, setMonthKeyState] = useState(currentMonthKey);
  const [month, setMonth] = useState(null);
  const [dynamicExpenses, setDynamicExpenses] = useState([]);
  const [monthLoading, setMonthLoading] = useState(false);
  const [monthView, setMonthView] = useState("calendar");
  const [monthWeekIndex, setMonthWeekIndex] = useState(0);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState("");
  const [modal, setModal] = useState(null);
  const [weekLoading, setWeekLoading] = useState(false);
  const [budgetDismissed, setBudgetDismissed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingLogout, setPendingLogout] = useState(false);
  const [pendingActual, setPendingActual] = useState(null);
  const weekRequestRef = useRef(0);
  const monthRequestRef = useRef(0);

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
    const requestId = weekRequestRef.current + 1;
    weekRequestRef.current = requestId;
    setWeekLoading(true);
    api(`/api/week?key=${weekKey}`)
      .then(({ week }) => {
        if (weekRequestRef.current !== requestId) return;
        setWeek(week);
        setError("");
      })
      .catch((error) => {
        if (weekRequestRef.current !== requestId) return;
        setError(`Не удалось загрузить неделю: ${error.message}`);
      })
      .finally(() => {
        if (weekRequestRef.current === requestId) setWeekLoading(false);
      });
  }, [user, weekKey]);

  useEffect(() => {
    if (!user) return;
    const requestId = monthRequestRef.current + 1;
    monthRequestRef.current = requestId;
    setMonthLoading(true);
    api(`/api/month?key=${monthKeyState}`)
      .then(({ month, dynamicExpenses }) => {
        if (monthRequestRef.current !== requestId) return;
        setMonth(month);
        setDynamicExpenses(dynamicExpenses || []);
        setMonthWeekIndex(0);
        setError("");
      })
      .catch((error) => {
        if (monthRequestRef.current !== requestId) return;
        setError(`Не удалось загрузить месяц: ${error.message}`);
      })
      .finally(() => {
        if (monthRequestRef.current === requestId) setMonthLoading(false);
      });
  }, [user, monthKeyState]);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  useEffect(() => {
    if (!month || pendingActual) return;
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (currentTime < (user?.settings?.confirmTime || "21:00")) return;
    const dueItem = (month.items || []).find((item) => item.askActual && !item.confirmed && item.date <= todayIso);
    if (dueItem) setPendingActual(dueItem);
  }, [month, pendingActual, user?.settings?.confirmTime]);

  const days = useMemo(() => (week ? buildWeekModel(weekKey, week) : []), [weekKey, week]);
  const currentDay = days.find((day) => day.iso === todayIso) || days[0];
  const expenseTitles = user?.expenseTitles || [];
  const monthModel = useMemo(
    () => (month ? buildMonthModel(monthKeyState, month, dynamicExpenses, user?.wallet) : { days: [], startBalance: 0, endBalance: 0, items: [] }),
    [monthKeyState, month, dynamicExpenses, user?.wallet],
  );
  const monthWeekGroups = useMemo(() => monthWeeks(monthModel.days), [monthModel.days]);
  const selectedMonthWeek = monthWeekGroups[monthWeekIndex] || monthWeekGroups[0] || { days: [] };

  function showServerError(action, error) {
    setError(`${action}: ${error.message}`);
  }

  async function saveBudget(budget, rememberBudget) {
    try {
      const data = await api("/api/week/budget", { method: "PUT", body: { key: weekKey, budget, rememberBudget } });
      setWeek(data.week);
      setUser(data.user);
      setBudgetDismissed(false);
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
      if (toMonthKey(new Date(data.expense.date)) === monthKeyState) {
        setDynamicExpenses((items) => [...items.filter((item) => item.id !== data.expense.id), { ...data.expense, flow: "dynamic", type: "expense" }]);
      }
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
      setDynamicExpenses((items) => items.filter((item) => item.id !== id));
      setPendingDelete(null);
      setError("");
    } catch (error) {
      showServerError("Не удалось удалить трату", error);
    }
  }

  async function saveSettings(settings) {
    try {
      const data = await api("/api/settings", { method: "PUT", body: settings });
      let nextUser = data.user;
      if (settings.walletBalance !== "" && Number(settings.walletBalance) !== Number(user.wallet?.balance ?? "")) {
        const walletData = await api("/api/wallet", { method: "PUT", body: { balance: Number(settings.walletBalance) } });
        nextUser = walletData.user;
        if (monthKeyState === currentMonthKey) setMonth(walletData.month);
      }
      setUser(nextUser);
      setModal(null);
      setError("");
    } catch (error) {
      showServerError("Не удалось сохранить настройки", error);
    }
  }

  async function saveMonthItem(item) {
    try {
      const data = await api("/api/month/items", { method: "POST", body: item });
      if (toMonthKey(new Date(item.date)) === monthKeyState) setMonth(data.month);
      setModal(null);
      setError("");
    } catch (error) {
      showServerError("Не удалось сохранить операцию", error);
    }
  }

  async function removeMonthItem(id) {
    try {
      const data = await api(`/api/month/items/${id}?monthKey=${monthKeyState}`, { method: "DELETE" });
      setMonth(data.month);
      setError("");
    } catch (error) {
      showServerError("Не удалось удалить операцию", error);
    }
  }

  async function confirmActualAmount(item, actualAmount) {
    try {
      const data = await api(`/api/month/items/${item.id}`, {
        method: "PUT",
        body: { ...item, monthKey: monthKeyState, actualAmount: Number(actualAmount), confirmed: true },
      });
      setMonth(data.month);
      setPendingActual(null);
      setError("");
    } catch (error) {
      showServerError("Не удалось уточнить сумму", error);
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
        onLogout={() => setPendingLogout(true)}
      />

      <nav className="section-tabs">
        <button className={activeSection === "overview" ? "active" : ""} onClick={() => setActiveSection("overview")}>Главная</button>
        <button className={activeSection === "week" ? "active" : ""} onClick={() => setActiveSection("week")}>Неделя</button>
        <button className={activeSection === "month" ? "active" : ""} onClick={() => setActiveSection("month")}>Месяц</button>
      </nav>

      {activeSection === "overview" && <OverviewScreen user={user} monthModel={monthModel} />}

      {activeSection === "week" && (
        <div className="week-content">
          <section className="summary">
            <div>
              <span className="label">Бюджет недели</span>
              <strong>{money(week.budget)} ₽</strong>
            </div>
            <button className="ghost-button" onClick={() => {
              setBudgetDismissed(false);
              setModal("budget");
            }}>Изменить</button>
          </section>

          <section className="day-list">
            {days.map((day) => (
              <DayRow key={day.iso} day={day} onRemove={setPendingDelete} />
            ))}
          </section>

          <Stats days={days} />

          {weekLoading && <LoadingOverlay />}
        </div>
      )}

      {activeSection === "month" && (
        <MonthPlanner
          monthKeyValue={monthKeyState}
          model={monthModel}
          view={monthView}
          weekGroups={monthWeekGroups}
          selectedWeek={selectedMonthWeek}
          weekIndex={monthWeekIndex}
          loading={monthLoading}
          onPrevMonth={() => setMonthKeyState(toMonthKey(addDays(dateFromMonthKey(monthKeyState), -1)))}
          onNextMonth={() => setMonthKeyState(toMonthKey(new Date(dateFromMonthKey(monthKeyState).getFullYear(), dateFromMonthKey(monthKeyState).getMonth() + 1, 1)))}
          onViewChange={setMonthView}
          onPrevWeek={() => setMonthWeekIndex(Math.max(0, monthWeekIndex - 1))}
          onNextWeek={() => setMonthWeekIndex(Math.min(monthWeekGroups.length - 1, monthWeekIndex + 1))}
          onAddItem={() => setModal("monthItem")}
          onRemoveItem={removeMonthItem}
        />
      )}

      {activeSection === "week" && !weekLoading && <button className="fab" aria-label="Добавить трату" onClick={() => setModal("expense")}>+</button>}
      {activeSection === "month" && !monthLoading && <button className="fab" aria-label="Добавить операцию" onClick={() => setModal("monthItem")}>+</button>}
      {error && <div className="toast" onClick={() => setError("")}>{error}</div>}
      {((needsBudget && !budgetDismissed) || modal === "budget") && (
        <BudgetModal
          user={user}
          onClose={() => {
            setBudgetDismissed(true);
            setModal(null);
          }}
          onSave={saveBudget}
          initial={week.budget ?? user.settings.defaultBudget ?? ""}
        />
      )}
      {modal === "expense" && <ExpenseModal days={days} titles={expenseTitles} onClose={() => setModal(null)} onSave={saveExpense} />}
      {modal === "monthItem" && <MonthItemModal monthKeyValue={monthKeyState} onClose={() => setModal(null)} onSave={saveMonthItem} />}
      {modal === "settings" && <SettingsModal user={user} onClose={() => setModal(null)} onSave={saveSettings} />}
      {pendingDelete && (
        <ConfirmDeleteModal
          expense={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => removeExpense(pendingDelete.id)}
        />
      )}
      {pendingLogout && (
        <ConfirmLogoutModal
          onCancel={() => setPendingLogout(false)}
          onConfirm={() => {
            setPendingLogout(false);
            logout();
          }}
        />
      )}
      {pendingActual && (
        <ActualAmountModal
          item={pendingActual}
          onSave={(amount) => confirmActualAmount(pendingActual, amount)}
        />
      )}
    </main>
  );
}

function Splash() {
  return <div className="center-screen"><div className="loader" /></div>;
}

function LoadingOverlay() {
  return (
    <div className="loading-overlay" aria-live="polite" aria-label="Загрузка недели">
      <div className="loader" />
    </div>
  );
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

function DayRow({ day, onRemove }) {
  const isFuture = day.iso > todayIso;
  const isToday = day.iso === todayIso;
  const over = day.diff < 0;
  return (
    <article className={isToday ? "day-row today" : "day-row"}>
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
              <div><b>{money(expense.amount)} ₽</b><button aria-label="Удалить" onClick={() => onRemove(expense)}>×</button></div>
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
  const [activeIndex, setActiveIndex] = useState(null);
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
  const activeDay = activeIndex === null ? null : days[activeIndex];
  const activePoint = activeDay ? point(activeDay, 0) : null;
  const todayDay = days.find((day) => day.iso === todayIso);
  const todayPoint = todayDay ? point(todayDay, 0) : null;
  const tooltipClass = activeIndex === 0 ? "chart-tooltip left-edge" : activeIndex === 6 ? "chart-tooltip right-edge" : "chart-tooltip";

  function updateActiveDay(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * width;
    const step = (width - pad * 2) / 6;
    const index = Math.max(0, Math.min(6, Math.round((svgX - pad) / step)));
    setActiveIndex(index);
  }

  return (
    <section className="stats">
      <div className="section-head">
        <h2>Статистика</h2>
        <span>по дням</span>
      </div>
      <div className="chart-wrap">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="График трат по дням"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            updateActiveDay(event);
          }}
          onPointerMove={(event) => {
            if (activeIndex !== null) updateActiveDay(event);
          }}
          onPointerUp={() => setActiveIndex(null)}
          onPointerCancel={() => setActiveIndex(null)}
          onContextMenu={(event) => event.preventDefault()}
        >
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
          {todayDay && <line x1={todayPoint[0]} x2={todayPoint[0]} y1={pad} y2={height - pad} className="today-chart-line" />}
          {activeDay && <line x1={activePoint[0]} x2={activePoint[0]} y1={pad} y2={height - pad} className="active-chart-line" />}
          {days.map((day) => {
            const [x] = point(day, 0);
            return <text key={day.iso} x={x} y={height - 6} textAnchor="middle">{dayNames[day.index]}</text>;
          })}
        </svg>
        {activeDay && (
          <div className={tooltipClass} style={{ left: `${(activePoint[0] / width) * 100}%` }}>
            <strong>{dayNames[activeDay.index]}, {activeDay.date.getDate()}</strong>
            {activeDay.iso > todayIso ? (
              <span>Можно будет потратить: {money(activeDay.allowed)} ₽</span>
            ) : (
              <>
                <span>Потратил: {money(activeDay.spent)} ₽</span>
                <span>{activeDay.iso === todayIso ? "Можно потратить" : "Можно было"}: {money(activeDay.allowed)} ₽</span>
                <span className={activeDay.diff >= 0 ? "good" : "bad"}>
                  {activeDay.diff >= 0 ? "Осталось" : "Перерасход"}: {money(Math.abs(activeDay.diff))} ₽
                </span>
              </>
            )}
          </div>
        )}
      </div>
      <div className="legend">
        <span><i className="spent-swatch" />Факт</span>
        <span><i className="allowed-swatch" />Можно</span>
      </div>
    </section>
  );
}

function OverviewScreen({ user, monthModel }) {
  const pastDays = monthModel.days.filter((day) => day.iso <= todayIso);
  return (
    <section className="overview">
      <section className="summary">
        <div>
          <span className="label">Кошелек</span>
          <strong>{user.wallet?.balance === null || user.wallet?.balance === undefined ? "Не указан" : `${money(user.wallet.balance)} ₽`}</strong>
        </div>
        <span className="label">{monthLabel(currentMonthKey)}</span>
      </section>
      <BalanceChart days={pastDays.length ? pastDays : monthModel.days} startBalance={monthModel.startBalance} title="Баланс по дням" />
      <section className="day-list compact">
        {pastDays.map((day) => (
          <article className={day.iso === todayIso ? "day-row today" : "day-row"} key={day.iso}>
            <div className="day-head">
              <div>
                <span className="label">{dayNames[(day.date.getDay() || 7) - 1]}, {day.date.getDate()}</span>
                <strong>{money(day.balanceBefore)} ₽ было в начале дня</strong>
              </div>
              <div className={day.net >= 0 ? "delta good" : "delta bad"}>{day.net >= 0 ? "+" : "-"}{money(Math.abs(day.net))} ₽</div>
            </div>
          </article>
        ))}
      </section>
    </section>
  );
}

function MonthPlanner({
  monthKeyValue,
  model,
  view,
  weekGroups,
  selectedWeek,
  weekIndex,
  loading,
  onPrevMonth,
  onNextMonth,
  onViewChange,
  onPrevWeek,
  onNextWeek,
  onAddItem,
  onRemoveItem,
}) {
  return (
    <div className="week-content">
      <section className="month-head">
        <button className="nav-button" aria-label="Предыдущий месяц" onClick={onPrevMonth}>‹</button>
        <div>
          <strong>{monthLabel(monthKeyValue)}</strong>
          <span>К концу месяца: {money(model.endBalance)} ₽</span>
        </div>
        <button className="nav-button" aria-label="Следующий месяц" onClick={onNextMonth}>›</button>
      </section>

      <div className="view-toggle">
        <button className={view === "calendar" ? "active" : ""} onClick={() => onViewChange("calendar")}>Календарь</button>
        <button className={view === "weeks" ? "active" : ""} onClick={() => onViewChange("weeks")}>Недели</button>
      </div>

      {view === "calendar" ? (
        <>
          <MonthCalendar days={model.days} onRemoveItem={onRemoveItem} />
          <BalanceChart days={model.days} startBalance={model.startBalance} title="Баланс месяца" />
        </>
      ) : (
        <MonthWeekView
          groups={weekGroups}
          week={selectedWeek}
          weekIndex={weekIndex}
          onPrevWeek={onPrevWeek}
          onNextWeek={onNextWeek}
          onRemoveItem={onRemoveItem}
        />
      )}

      <button className="wide-action" onClick={onAddItem}>Добавить фиксированную операцию</button>
      {loading && <LoadingOverlay />}
    </div>
  );
}

function MonthCalendar({ days, onRemoveItem }) {
  return (
    <section className="month-calendar">
      {dayNames.map((day) => <span className="calendar-weekday" key={day}>{day}</span>)}
      {Array.from({ length: days[0] ? (days[0].date.getDay() || 7) - 1 : 0 }).map((_, index) => <span key={index} />)}
      {days.map((day) => (
        <article className={day.iso === todayIso ? "calendar-day today" : "calendar-day"} key={day.iso}>
          <strong>{day.date.getDate()}</strong>
          <span>{day.income ? `+${money(day.income)} ₽` : ""}</span>
          <span>{day.expense ? `-${money(day.expense)} ₽` : ""}</span>
          <small>{money(day.balanceAfter)} ₽</small>
          {day.items.filter((item) => item.flow === "fixed").map((item) => (
            <button className="mini-remove" key={item.id} onClick={() => onRemoveItem(item.id)} aria-label="Удалить операцию">×</button>
          ))}
        </article>
      ))}
    </section>
  );
}

function MonthWeekView({ groups, week, weekIndex, onPrevWeek, onNextWeek, onRemoveItem }) {
  return (
    <>
      <section className="month-head compact-head">
        <button className="nav-button" aria-label="Предыдущая неделя месяца" disabled={weekIndex === 0} onClick={onPrevWeek}>‹</button>
        <div>
          <strong>{weekIndex + 1}-я неделя месяца</strong>
          <span>{week.days[0]?.date.getDate()} - {week.days[week.days.length - 1]?.date.getDate()}</span>
        </div>
        <button className="nav-button" aria-label="Следующая неделя месяца" disabled={weekIndex >= groups.length - 1} onClick={onNextWeek}>›</button>
      </section>
      <section className="day-list">
        {week.days.map((day) => (
          <article className={day.iso === todayIso ? "day-row today" : "day-row"} key={day.iso}>
            <div className="day-head">
              <div>
                <span className="label">{dayNames[(day.date.getDay() || 7) - 1]}, {day.date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</span>
                <strong>{money(day.balanceAfter)} ₽ баланс</strong>
              </div>
              <div className={day.net >= 0 ? "delta good" : "delta bad"}>{day.net >= 0 ? "+" : "-"}{money(Math.abs(day.net))} ₽</div>
            </div>
            <MonthDayItems items={day.items} onRemoveItem={onRemoveItem} />
          </article>
        ))}
      </section>
    </>
  );
}

function MonthDayItems({ items, onRemoveItem }) {
  if (!items.length) return <p className="empty-day">Операций нет</p>;
  return (
    <div className="expenses">
      {items.map((item) => (
        <div className="expense" key={`${item.flow}-${item.id}`}>
          <div>
            <span>{item.source === "wallet-adjustment" ? "Корректировка баланса" : item.flow === "fixed" ? "Фиксированная" : "Динамическая"}</span>
            <strong>{item.title || "Без названия"}</strong>
          </div>
          <div>
            <b className={item.type === "income" ? "good" : "bad"}>{item.type === "income" ? "+" : "-"}{money(item.actualAmount ?? item.amount)} ₽</b>
            {item.flow === "fixed" && <button aria-label="Удалить" onClick={() => onRemoveItem(item.id)}>×</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

function BalanceChart({ days, startBalance, title }) {
  const width = 330;
  const height = 210;
  const pad = 28;
  const values = days.map((day) => day.balanceAfter);
  const min = Math.min(startBalance, ...values, 0);
  const max = Math.max(startBalance, ...values, 1);
  const range = Math.max(1, max - min);
  const point = (index, value) => {
    const x = pad + (index * (width - pad * 2)) / Math.max(1, days.length - 1);
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    return [x, y];
  };
  const line = days.map((day, index) => point(index, day.balanceAfter).join(",")).join(" ");
  const startY = point(0, startBalance)[1];
  return (
    <section className="stats">
      <div className="section-head">
        <h2>{title}</h2>
        <span>{days.length ? `${money(days[days.length - 1].balanceAfter)} ₽` : "нет данных"}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <line x1={pad} x2={width - pad} y1={startY} y2={startY} className="start-balance-line" />
        <polyline points={line} className="balance-line" />
        {days.map((day, index) => {
          const [x, y] = point(index, day.balanceAfter);
          return <circle key={day.iso} cx={x} cy={y} r="4.5" className={day.iso === todayIso ? "dot today-dot" : "dot balance-dot"} />;
        })}
      </svg>
      <div className="legend">
        <span><i className="balance-swatch" />Баланс</span>
        <span><i className="start-swatch" />Начало месяца</span>
      </div>
    </section>
  );
}

function BudgetModal({ user, initial, onClose, onSave }) {
  const [budget, setBudget] = useState(initial);
  const [remember, setRemember] = useState(Boolean(user.settings.rememberBudget));
  return (
    <Modal title="Бюджет недели" onClose={onClose}>
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
  const [title, setTitle] = useState("");
  const [isTitlePickerOpen, setIsTitlePickerOpen] = useState(false);
  const filteredTitles = titles
    .filter((item) => item.toLowerCase().includes(title.trim().toLowerCase()))
    .slice(0, 8);

  return (
    <Modal title="Новая трата" onClose={onClose}>
      <label>Дата<select value={date} onChange={(event) => setDate(event.target.value)}>{days.map((day) => <option value={day.iso} key={day.iso}>{dayNames[day.index]}, {day.date.getDate()}</option>)}</select></label>
      <label>Название
        <div className="title-picker">
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setIsTitlePickerOpen(true);
            }}
            onFocus={() => setIsTitlePickerOpen(true)}
            onBlur={() => window.setTimeout(() => setIsTitlePickerOpen(false), 120)}
            placeholder="Найти или ввести новое"
            autoComplete="off"
          />
          {isTitlePickerOpen && filteredTitles.length > 0 && (
            <div className="title-suggestions">
              {filteredTitles.map((item) => (
                <button
                  type="button"
                  key={item}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setTitle(item);
                    setIsTitlePickerOpen(false);
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>
      </label>
      <label>Сумма<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" /></label>
      <button className="primary-button" onClick={() => onSave({ date, amount: Number(amount), title: title.trim() })}>Добавить</button>
    </Modal>
  );
}

function MonthItemModal({ monthKeyValue, onClose, onSave }) {
  const [date, setDate] = useState(`${monthKeyValue}-01`);
  const [type, setType] = useState("expense");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [askActual, setAskActual] = useState(false);

  return (
    <Modal title="Фиксированная операция" onClose={onClose}>
      <label>Дата<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label>Тип<select value={type} onChange={(event) => setType(event.target.value)}>
        <option value="expense">Трата</option>
        <option value="income">Пополнение</option>
      </select></label>
      <label>Название<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, аренда" /></label>
      <label>Сумма<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" /></label>
      <label className="check-row"><input type="checkbox" checked={askActual} onChange={(event) => setAskActual(event.target.checked)} />Уточнить сумму в день операции</label>
      <button className="primary-button" onClick={() => onSave({ date, type, title, amount: Number(amount), askActual })}>Сохранить</button>
    </Modal>
  );
}

function SettingsModal({ user, onClose, onSave }) {
  const [rememberBudget, setRememberBudget] = useState(Boolean(user.settings.rememberBudget));
  const [defaultBudget, setDefaultBudget] = useState(user.settings.defaultBudget ?? "");
  const [walletBalance, setWalletBalance] = useState(user.wallet?.balance ?? "");
  const [confirmTime, setConfirmTime] = useState(user.settings.confirmTime || "21:00");
  return (
    <Modal title="Настройки" onClose={onClose}>
      <label>Текущий баланс кошелька<input inputMode="decimal" value={walletBalance} onChange={(event) => setWalletBalance(event.target.value)} /></label>
      <label>Время уточнения суммы<input type="time" value={confirmTime} onChange={(event) => setConfirmTime(event.target.value)} /></label>
      <label className="check-row"><input type="checkbox" checked={rememberBudget} onChange={(event) => setRememberBudget(event.target.checked)} />Запоминать бюджет</label>
      <label>Бюджет по умолчанию<input inputMode="decimal" value={defaultBudget} onChange={(event) => setDefaultBudget(event.target.value)} /></label>
      <button className="primary-button" onClick={() => onSave({ rememberBudget, confirmTime, walletBalance, defaultBudget: defaultBudget === "" ? null : Number(defaultBudget) })}>Сохранить</button>
    </Modal>
  );
}

function ConfirmDeleteModal({ expense, onCancel, onConfirm }) {
  return (
    <Modal title="Удалить трату?" onClose={onCancel}>
      <p className="modal-copy">{expense.title || "Без названия"} · {money(expense.amount)} ₽</p>
      <div className="modal-actions">
        <button className="secondary-button" onClick={onCancel}>Отмена</button>
        <button className="danger-button" onClick={onConfirm}>Удалить</button>
      </div>
    </Modal>
  );
}

function ConfirmLogoutModal({ onCancel, onConfirm }) {
  return (
    <Modal title="Выйти из аккаунта?" onClose={onCancel}>
      <p className="modal-copy">Текущая сессия будет завершена на этом устройстве.</p>
      <div className="modal-actions">
        <button className="secondary-button" onClick={onCancel}>Отмена</button>
        <button className="danger-button" onClick={onConfirm}>Выйти</button>
      </div>
    </Modal>
  );
}

function ActualAmountModal({ item, onSave }) {
  const [amount, setAmount] = useState(item.actualAmount ?? item.amount ?? "");
  return (
    <Modal title="Уточнить сумму">
      <p className="modal-copy">{item.title || "Операция"} · {item.date}</p>
      <label>Фактическая сумма<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus /></label>
      <button className="primary-button" onClick={() => onSave(Number(amount))}>Сохранить</button>
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
