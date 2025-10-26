import { CheckCircle, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";

const PaymentSuccess = () => {
  return (
    <div className="min-h-screen bg-gradient-pitch flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center shadow-card-hover">
        <CardHeader>
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle className="h-10 w-10 text-green-600" />
          </div>
          <CardTitle className="text-2xl">Thanh toán thành công!</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-muted-foreground">
            Cảm ơn bạn đã hoàn tất thanh toán. Khoản nợ của bạn đã được ghi
            nhận.
          </p>
          <Button asChild size="lg" className="w-full">
            <Link to="/pay">
              <Home className="mr-2 h-5 w-5" />
              Về trang chủ
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default PaymentSuccess;
