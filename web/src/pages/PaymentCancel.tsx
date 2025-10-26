import { XCircle, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";

const PaymentCancel = () => {
  return (
    <div className="min-h-screen bg-gradient-pitch flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center shadow-card-hover">
        <CardHeader>
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-red-100 flex items-center justify-center">
            <XCircle className="h-10 w-10 text-red-600" />
          </div>
          <CardTitle className="text-2xl">Giao dịch đã bị hủy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-muted-foreground">
            Giao dịch của bạn đã bị hủy hoặc đã xảy ra lỗi. Vui lòng thử lại.
          </p>
          <Button asChild size="lg" className="w-full">
            <Link to="/pay">
              <Home className="mr-2 h-5 w-5" />
              Thử lại thanh toán
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default PaymentCancel;
