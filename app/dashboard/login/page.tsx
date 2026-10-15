import LoginForm from "./LoginForm";

export const metadata = { title: "Dashboard — Sign in" };

export default function DashboardLoginPage() {
  return (
    <div className="flex flex-col items-center gap-6 pt-16">
      <h1 className="text-xl font-medium">Financial dashboard</h1>
      <LoginForm />
    </div>
  );
}
