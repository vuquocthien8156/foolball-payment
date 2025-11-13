import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarCheck, CreditCard, Trophy } from "lucide-react";
import { Link } from "react-router-dom";

const PublicPortal = () => {
  return (
    <div className="min-h-screen animated-gradient flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-4 bg-primary rounded-2xl shadow-card mb-4">
            <Trophy className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-foreground">
            Cổng thông tin đội bóng
          </h1>
          <p className="text-muted-foreground mt-2">
            Vui lòng chọn hành động bạn muốn thực hiện.
          </p>
        </div>

        <div className="space-y-6">
          <Link to="/public/attendance" className="block">
            <Card className="shadow-card hover:shadow-card-hover transition-all cursor-pointer group">
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center group-hover:scale-110 transition-transform shadow-card">
                  <CalendarCheck className="h-6 w-6 text-white" />
                </div>
                <div>
                  <CardTitle className="text-xl">Điểm danh</CardTitle>
                  <CardDescription>
                    Xác nhận tham gia trận đấu sắp tới.
                  </CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link to="/public/pay" className="block">
            <Card className="shadow-card hover:shadow-card-hover transition-all cursor-pointer group">
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center group-hover:scale-110 transition-transform shadow-card">
                  <CreditCard className="h-6 w-6 text-white" />
                </div>
                <div>
                  <CardTitle className="text-xl">Thanh toán</CardTitle>
                  <CardDescription>
                    Xem và thanh toán các khoản nợ.
                  </CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default PublicPortal;
